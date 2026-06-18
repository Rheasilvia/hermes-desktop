import { Component, JSX, onMount, onCleanup, createSignal, Show, createMemo, createEffect, untrack } from 'solid-js';
import { useNavigate, useLocation } from '@solidjs/router';
import { Sidebar } from '@/shell/Sidebar';
import { TitleBar } from '@/shell/TitleBar';
import { CommandPalette, buildDefaultActions } from '@/shell/CommandPalette';
import type { PaletteAction } from '@/shell/CommandPalette';
import { RightToolPanel } from '@/features/conversation/RightToolPanel.js';
import { sessionStore } from '@/stores/session.js';
import { modelStore, modelsStore } from '@/stores/models.js';
import { clampSidebarWidth, uiStore } from '@/stores/ui.js';
import { sidePanelStore } from '@/stores/side-panel.js';
import { initKeyboardShortcuts, destroyKeyboardShortcuts } from '@/services/keyboard.js';
import { loadState } from '@/services/api/state.js';
import { LoadingSpinner } from '@/ui/atoms/LoadingSpinner';
import { getGateway } from '@/stores/context.js';
import { setApprovalResponder, setSessionFocuser, teardownNativeNotifications } from '@/services/notifications/native-notifications.js';
import { cycleActiveReasoningEffort, updateActiveReasoningEffort } from './reasoning-actions.js';
import {
  SPLIT_CHROME_WIDTH,
  SPLIT_DRAG_HANDLE_WIDTH,
  clampToolsDockWidth,
  shouldOverlayToolsDock,
} from './right-tools-layout.js';
import styles from './AppLayout.module.css';

interface AppLayoutProps {
  children?: JSX.Element;
}

const LAYOUT_RESIZE_SETTLE_MS = 120;

export const AppLayout: Component<AppLayoutProps> = (props) => {
  const navigate = useNavigate();
  const location = useLocation();
  let layoutRef: HTMLDivElement | undefined;
  let leftDragHandleEl: HTMLDivElement | undefined;
  let rightDragHandleEl: HTMLDivElement | undefined;
  let pendingLayoutWidth: number | null = null;
  let pendingSidebarDragWidth: number | null = null;
  let pendingRightDragWidth: number | null = null;
  let layoutResizeFrame: number | null = null;
  let sidebarDragFrame: number | null = null;
  let rightDragFrame: number | null = null;
  let layoutResizeEndTimer: ReturnType<typeof setTimeout> | undefined;
  const [initializing, setInitializing] = createSignal(true);
  const [layoutWidth, setLayoutWidth] = createSignal(0);
  const [layoutResizing, setLayoutResizing] = createSignal(false);
  const [sidebarDragWidth, setSidebarDragWidth] = createSignal<number | null>(null);
  const [rightDragWidth, setRightDragWidth] = createSignal<number | null>(null);
  const [rightToolsOverlayMode, setRightToolsOverlayMode] = createSignal(false);
  const isSettingsRoute = createMemo(() =>
    location.pathname === '/settings' || location.pathname.startsWith('/settings/'),
  );
  const isConversationRoute = createMemo(() =>
    location.pathname.startsWith('/conversation/'),
  );
  const showPrimarySidebar = createMemo(() =>
    !isSettingsRoute() && !uiStore.sidebarCollapsed,
  );
  const effectiveSidebarWidth = createMemo(() =>
    sidebarDragWidth() ?? uiStore.sidebarWidth,
  );
  const conversationSplitWidth = createMemo(() =>
    Math.max(0, layoutWidth() - (showPrimarySidebar() ? effectiveSidebarWidth() : 0)),
  );
  const rightToolsVisible = createMemo(() =>
    sidePanelStore.isOpen() && isConversationRoute(),
  );
  const rightToolsOverlay = createMemo(() =>
    rightToolsVisible() && rightToolsOverlayMode(),
  );
  const rightToolsDocked = createMemo(() =>
    rightToolsVisible() && !rightToolsOverlay(),
  );
  const effectiveRightToolsWidth = createMemo(() => {
    const draggedWidth = rightDragWidth();
    if (draggedWidth !== null) return draggedWidth;

    const preferredWidth = sidePanelStore.panelWidth();
    const containerWidth = conversationSplitWidth();
    if (!rightToolsDocked() || containerWidth <= 0) return preferredWidth;

    return clampToolsDockWidth(preferredWidth, containerWidth);
  });
  const rightToolsReservedWidth = createMemo(() =>
    effectiveRightToolsWidth() + SPLIT_CHROME_WIDTH,
  );
  const rightToolsDragHandleRight = createMemo(() =>
    Math.max(0, effectiveRightToolsWidth() - (SPLIT_DRAG_HANDLE_WIDTH / 2)),
  );
  const leftSidebarDragHandleLeft = createMemo(() =>
    Math.max(0, effectiveSidebarWidth() - (SPLIT_DRAG_HANDLE_WIDTH / 2)),
  );
  const rightToolsSessionId = createMemo(() =>
    sessionStore.activeSessionId,
  );
  const rightToolsWorkspacePath = createMemo(() =>
    sessionStore.activeSession?.cwd ?? null,
  );
  const mainFrameStyle = createMemo<JSX.CSSProperties>(() => {
    const style: JSX.CSSProperties = {
      display: 'flex',
      flex: '1 1 0',
      'min-width': '0',
      'min-height': '0',
      overflow: 'hidden',
    };
    if (rightToolsDocked()) {
      style['margin-right'] = `${rightToolsReservedWidth()}px`;
    }
    return style;
  });
  const rightToolsDockStyle = createMemo<JSX.CSSProperties>(() => {
    const style: JSX.CSSProperties = {
      position: 'absolute',
      top: 'var(--titlebar-height)',
      right: '0',
      bottom: '0',
      overflow: 'hidden',
    };
    if (rightToolsOverlay()) {
      style.left = showPrimarySidebar() ? `${effectiveSidebarWidth()}px` : '0';
    } else {
      style.width = `${effectiveRightToolsWidth()}px`;
    }
    return style;
  });

  const handleNewSession = async () => {
    try {
      const meta = await sessionStore.createSession({});
      if (meta) {
        navigate(`/conversation/${meta.id}`);
      }
    } catch {
      // silently ignore errors
    }
  };

  const paletteActions = (): PaletteAction[] =>
    buildDefaultActions({
      onNavigate: (route: string) => navigate(route),
      onNewSession: handleNewSession,
      onToggleSidebar: () => uiStore.toggleSidebar(),
      onCompressContext: () => {},
      onClearHistory: () => {},
      onSwitchModel: () => navigate('/settings/model'),
      onCycleReasoningEffort: cycleActiveReasoningEffort,
      onSetReasoningEffort: updateActiveReasoningEffort,
    });

  const clearLayoutResizeEndTimer = () => {
    if (!layoutResizeEndTimer) return;
    clearTimeout(layoutResizeEndTimer);
    layoutResizeEndTimer = undefined;
  };

  const finishLayoutResizingSoon = () => {
    clearLayoutResizeEndTimer();
    layoutResizeEndTimer = setTimeout(() => {
      setLayoutResizing(false);
      layoutResizeEndTimer = undefined;
    }, LAYOUT_RESIZE_SETTLE_MS);
  };

  const applyLayoutWidth = (width: number, markResize: boolean) => {
    const nextWidth = Math.max(0, Math.round(width));
    const previousWidth = layoutWidth();
    if (markResize && previousWidth > 0 && previousWidth !== nextWidth) {
      setLayoutResizing(true);
      finishLayoutResizingSoon();
    }
    setLayoutWidth(nextWidth);
  };

  const scheduleLayoutWidth = (width: number) => {
    pendingLayoutWidth = width;
    if (layoutResizeFrame !== null) return;
    layoutResizeFrame = requestAnimationFrame(() => {
      layoutResizeFrame = null;
      const nextWidth = pendingLayoutWidth;
      pendingLayoutWidth = null;
      if (nextWidth !== null) {
        applyLayoutWidth(nextWidth, true);
      }
    });
  };

  onMount(() => {
    const updateLayoutWidth = () => {
      scheduleLayoutWidth(layoutRef?.clientWidth ?? 0);
    };

    applyLayoutWidth(layoutRef?.clientWidth ?? 0, false);
    if (!layoutRef || typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver(updateLayoutWidth);
    observer.observe(layoutRef);
    onCleanup(() => observer.disconnect());
  });

  createEffect(() => {
    const containerWidth = conversationSplitWidth();
    if (!rightToolsVisible() || containerWidth <= 0) {
      setRightToolsOverlayMode(false);
      return;
    }

    setRightToolsOverlayMode(
      shouldOverlayToolsDock(containerWidth, untrack(rightToolsOverlayMode)),
    );
  });

  const scheduleSidebarDragWidth = (width: number) => {
    pendingSidebarDragWidth = width;
    if (sidebarDragFrame !== null) return;
    sidebarDragFrame = requestAnimationFrame(() => {
      sidebarDragFrame = null;
      const nextWidth = pendingSidebarDragWidth;
      pendingSidebarDragWidth = null;
      if (nextWidth !== null) {
        setSidebarDragWidth(nextWidth);
      }
    });
  };

  const scheduleRightDragWidth = (width: number) => {
    pendingRightDragWidth = width;
    if (rightDragFrame !== null) return;
    rightDragFrame = requestAnimationFrame(() => {
      rightDragFrame = null;
      const nextWidth = pendingRightDragWidth;
      pendingRightDragWidth = null;
      if (nextWidth !== null) {
        setRightDragWidth(nextWidth);
      }
    });
  };

  const flushSidebarDragWidth = (fallbackWidth: number) => {
    const nextWidth = pendingSidebarDragWidth ?? fallbackWidth;
    if (sidebarDragFrame !== null) {
      cancelAnimationFrame(sidebarDragFrame);
      sidebarDragFrame = null;
    }
    pendingSidebarDragWidth = null;
    setSidebarDragWidth(nextWidth);
    return nextWidth;
  };

  const flushRightDragWidth = (fallbackWidth: number) => {
    const nextWidth = pendingRightDragWidth ?? fallbackWidth;
    if (rightDragFrame !== null) {
      cancelAnimationFrame(rightDragFrame);
      rightDragFrame = null;
    }
    pendingRightDragWidth = null;
    setRightDragWidth(nextWidth);
    return nextWidth;
  };

  const handleLeftSidebarDragStart = (e: MouseEvent) => {
    e.preventDefault();
    if (!showPrimarySidebar()) return;
    if (leftDragHandleEl) leftDragHandleEl.classList.add(styles.leftDragHandleActive);
    if (layoutRef) layoutRef.classList.add(styles.layoutDragging);

    const startX = e.clientX;
    const startWidth = clampSidebarWidth(effectiveSidebarWidth());
    let lastWidth = startWidth;
    setSidebarDragWidth(startWidth);

    const onMove = (ev: MouseEvent) => {
      const delta = ev.clientX - startX;
      lastWidth = clampSidebarWidth(startWidth + delta);
      scheduleSidebarDragWidth(lastWidth);
    };

    const onUp = () => {
      if (leftDragHandleEl) leftDragHandleEl.classList.remove(styles.leftDragHandleActive);
      if (layoutRef) layoutRef.classList.remove(styles.layoutDragging);
      const committedWidth = flushSidebarDragWidth(lastWidth);
      uiStore.setSidebarWidth(committedWidth);
      setSidebarDragWidth(null);
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  const handleRightToolsDragStart = (e: MouseEvent) => {
    e.preventDefault();
    if (!rightToolsDocked()) return;
    if (rightDragHandleEl) rightDragHandleEl.classList.add(styles.rightDragHandleActive);
    if (layoutRef) layoutRef.classList.add(styles.layoutDragging);

    const startX = e.clientX;
    const containerWidth = conversationSplitWidth() || layoutRef?.clientWidth || 1200;
    const startWidth = clampToolsDockWidth(effectiveRightToolsWidth(), containerWidth);
    let lastWidth = startWidth;
    setRightDragWidth(startWidth);

    const onMove = (ev: MouseEvent) => {
      const delta = startX - ev.clientX;
      lastWidth = clampToolsDockWidth(startWidth + delta, containerWidth);
      scheduleRightDragWidth(lastWidth);
    };

    const onUp = () => {
      if (rightDragHandleEl) rightDragHandleEl.classList.remove(styles.rightDragHandleActive);
      if (layoutRef) layoutRef.classList.remove(styles.layoutDragging);
      const committedWidth = flushRightDragWidth(lastWidth);
      sidePanelStore.setPanelWidth(clampToolsDockWidth(committedWidth, containerWidth));
      setRightDragWidth(null);
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  onMount(async () => {
    // Detect the OS once so platform-specific chrome (e.g. the title bar's
    // native-vs-custom window controls) renders correctly. Off-Tauri (browser
    // preview) this resolves to 'unknown' and is harmless.
    try {
      const { isTauri } = await import('@tauri-apps/api/core');
      if (isTauri()) {
        const { invoke } = await import('@tauri-apps/api/core');
        const platform = await invoke<'macos' | 'windows' | 'linux'>('get_platform');
        uiStore.setPlatform(platform);
      }
    } catch {
      /* best-effort — 'unknown' platform falls back to no custom controls */
    }

    initKeyboardShortcuts({
      onToggleSidebar: () => uiStore.toggleSidebar(),
      onNavigate: (route: string) => navigate(route),
      onNewSession: handleNewSession,
      onToggleCommandPalette: () => {},
    });

    const gateway = getGateway();
    if (gateway) {
      const onTitleUpdate = (payload: { session_id: string; title: string }) => {
        sessionStore.updateSessionTitle(payload.session_id, payload.title);
      };
      const onReconnect = () => { sessionStore.loadSessions(); };
      const onModelChanged = (payload: { provider: string; model: string }) => {
        // External change (CLI/TUI/other window): reconcile default selection + refresh catalog
        modelStore.hydrateDefaultModel(payload.provider, payload.model);
        modelsStore.invalidate();
        void modelsStore.load();
      };
      gateway.on('session.title_update', onTitleUpdate);
      // On reconnect after backend restart, refresh the session list
      gateway.on('gateway.ready', onReconnect);
      gateway.on('model.changed', onModelChanged);
      onCleanup(() => {
        gateway.off('session.title_update', onTitleUpdate);
        gateway.off('gateway.ready', onReconnect);
        gateway.off('model.changed', onModelChanged);
      });
    }

    // Wire native-notification action + click callbacks.
    // Approval actions (Approve/Reject buttons) resolve straight to the sidecar;
    // the inline approval card remains the always-present primary surface.
    setApprovalResponder(gateway
      ? async (sessionId, command, choice) => {
        try {
          await gateway.approval.respond({ session_id: sessionId, command, choice });
        } catch {
          /* best-effort — the inline card is still actionable */
        }
      }
      : null);
    setSessionFocuser((sessionId) => {
      if (sessionId) navigate(`/conversation/${sessionId}`);
      void import('@tauri-apps/api/core').then(({ isTauri }) => {
        if (!isTauri()) return;
        return import('@tauri-apps/api/window').then(({ getCurrentWindow }) => getCurrentWindow().setFocus());
      }).catch(() => {});
    });
    onCleanup(() => {
      setApprovalResponder(null);
      setSessionFocuser(null);
      teardownNativeNotifications();
    });

    // App.tsx guarantees the backend is available before AppLayout mounts
    await sessionStore.loadSessions();
    const sessions = sessionStore.sessions;
    const isHome = location.pathname === '/' || location.pathname === '';

    if (isHome) {
      if (sessions.length > 0) {
        try {
          const state = await loadState();
          const lastSessionId = state.last_session_id;
          if (lastSessionId && sessions.some((s) => s.id === lastSessionId)) {
            navigate(`/conversation/${lastSessionId}`, { replace: true });
            setInitializing(false);
            return;
          }
        } catch {
          // state load failed, fall through to most recent
        }
        navigate(`/conversation/${sessions[0].id}`, { replace: true });
      } else {
        const meta = await sessionStore.createSession({});
        if (meta) navigate(`/conversation/${meta.id}`, { replace: true });
      }
    }

    setInitializing(false);
  });

  onCleanup(() => {
    if (layoutResizeFrame !== null) {
      cancelAnimationFrame(layoutResizeFrame);
    }
    if (sidebarDragFrame !== null) {
      cancelAnimationFrame(sidebarDragFrame);
    }
    if (rightDragFrame !== null) {
      cancelAnimationFrame(rightDragFrame);
    }
    clearLayoutResizeEndTimer();
    destroyKeyboardShortcuts();
  });

  return (
    <div
      class={styles.layout}
      classList={{ [styles.layoutResizing]: layoutResizing() }}
      style={{
        display: 'flex',
        'flex-direction': 'row',
        height: '100vh',
        width: '100vw',
        overflow: 'hidden',
        position: 'relative',
      }}
      data-testid="app-layout"
      ref={(el) => { layoutRef = el; }}
    >
      <Show when={initializing()}>
        <div style={{ display: 'flex', 'align-items': 'center', 'justify-content': 'center', height: '100vh', position: 'absolute', inset: '0', 'z-index': 'var(--z-overlay)', background: 'var(--color-background)' }}>
          <LoadingSpinner size="lg" label="Starting Hermes..." />
        </div>
      </Show>
      <Show when={showPrimarySidebar()}>
        <div
          class={styles.sidebarDock}
          style={{
            width: `${effectiveSidebarWidth()}px`,
            flex: '0 0 auto',
            height: '100%',
            'min-height': '0',
            position: 'relative',
          }}
          data-testid="sidebar-dock"
        >
          <Sidebar />
        </div>
      </Show>
      <div
        class={styles.workspaceFrame}
        style={{
          display: 'flex',
          'flex-direction': 'column',
          flex: '1 1 0',
          'min-width': '0',
          'min-height': '0',
          overflow: 'hidden',
        }}
        data-testid="workspace-frame"
      >
        <TitleBar
          onToggleSidebar={() => uiStore.toggleSidebar()}
          onNavigateBack={() => navigate(-1)}
          onNavigateForward={() => navigate(1)}
          onNewSession={handleNewSession}
          actionToolbarLeft={showPrimarySidebar() ? 'var(--space-2)' : undefined}
          toolsDockWidth={rightToolsDocked() ? effectiveRightToolsWidth() : null}
        />
        <div
          class={styles.mainFrame}
          style={mainFrameStyle()}
          data-testid="workspace-content-frame"
        >
          <div class={styles.mainColumn}>
            <main class={styles.content}>
              {props.children}
            </main>
          </div>
        </div>
      </div>
      <Show when={showPrimarySidebar()}>
        <div
          class={styles.leftSidebarSeparator}
          style={{
            position: 'absolute',
            top: '0',
            bottom: '0',
            width: '1px',
            left: `${effectiveSidebarWidth()}px`,
          }}
          data-testid="left-sidebar-separator"
          aria-hidden="true"
        />
        <div
          ref={(el) => { leftDragHandleEl = el; }}
          class={styles.leftDragHandle}
          style={{
            position: 'absolute',
            top: '0',
            bottom: '0',
            width: `${SPLIT_DRAG_HANDLE_WIDTH}px`,
            left: `${leftSidebarDragHandleLeft()}px`,
          }}
          onMouseDown={handleLeftSidebarDragStart}
          data-testid="left-sidebar-drag-handle"
        />
      </Show>
      <Show when={rightToolsVisible() && !rightToolsOverlay()}>
        <div
          class={styles.rightDiffSeparator}
          style={{
            position: 'absolute',
            top: '0',
            bottom: '0',
            width: '1px',
            right: `${effectiveRightToolsWidth()}px`,
          }}
          data-testid="right-tools-separator"
          aria-hidden="true"
        />
        <div
          ref={(el) => { rightDragHandleEl = el; }}
          class={styles.rightDragHandle}
          style={{
            position: 'absolute',
            top: '0',
            bottom: '0',
            width: `${SPLIT_DRAG_HANDLE_WIDTH}px`,
            right: `${rightToolsDragHandleRight()}px`,
          }}
          onMouseDown={handleRightToolsDragStart}
          data-testid="right-tools-drag-handle"
        />
      </Show>
      <Show when={rightToolsVisible()}>
        <div
          class={styles.rightToolsDock}
          classList={{ [styles.rightToolsDockOverlay]: rightToolsOverlay() }}
          style={rightToolsDockStyle()}
          data-testid="right-tools-dock"
        >
          <RightToolPanel
            sessionId={rightToolsSessionId()}
            workspacePath={rightToolsWorkspacePath()}
            overlay={rightToolsOverlay()}
          />
        </div>
      </Show>
      <CommandPalette actions={paletteActions()} />
    </div>
  );
};
