import { Component, JSX, onMount, onCleanup, createSignal, Show, createMemo, createEffect, untrack } from 'solid-js';
import { useNavigate, useLocation } from '@solidjs/router';
import { Sidebar } from '@/shell/Sidebar';
import { TitleBar } from '@/shell/TitleBar';
import { ToolDockToolbar } from '@/shell/ToolDockToolbar';
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
  SPLIT_DRAG_HANDLE_WIDTH,
  clampToolsDockWidth,
  shouldOverlayToolsDock,
} from './right-tools-layout.js';
import styles from './AppLayout.module.css';

interface AppLayoutProps {
  children?: JSX.Element;
}

const LAYOUT_RESIZE_SETTLE_MS = 120;

const terminalTitleFromWorkspacePath = (path: string | null) => {
  const cwd = path?.trim();
  if (!cwd) return 'Terminal';
  const normalized = cwd.replace(/[\\/]+$/, '');
  const name = normalized.split(/[\\/]/).filter(Boolean).pop();
  return name || 'Terminal';
};

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
  let activeDragCancel: (() => void) | null = null;
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
  const rightToolsMounted = createMemo(() =>
    rightToolsVisible()
    || (isConversationRoute() && sidePanelStore.openTabs().some((tab) => tab.kind === 'terminal')),
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
  const rightToolsDragHandleRight = createMemo(() =>
    Math.max(0, effectiveRightToolsWidth() - (SPLIT_DRAG_HANDLE_WIDTH / 2)),
  );
  const rightToolsDragActive = createMemo(() => rightDragWidth() !== null);
  const committedRightToolsWidth = createMemo(() => {
    // Track the drag lifecycle without feeding live widths into content that
    // should stay committed until the resize finishes.
    rightToolsDragActive();
    if (!rightToolsDocked()) return null;

    const preferredWidth = sidePanelStore.panelWidth();
    const containerWidth = conversationSplitWidth();
    if (containerWidth <= 0) return preferredWidth;

    return clampToolsDockWidth(preferredWidth, containerWidth);
  });
  const rightToolsContentResizeMode = createMemo(() =>
    sidePanelStore.activeView() === 'terminal' ? 'deferred' : 'live',
  );
  const rightToolsContentWidth = createMemo(() => {
    if (!rightToolsDocked()) return null;
    if (rightToolsDragActive() && rightToolsContentResizeMode() === 'live') {
      return effectiveRightToolsWidth();
    }
    return committedRightToolsWidth();
  });
  const rightToolsContentResizing = createMemo(() =>
    rightToolsDragActive() && sidePanelStore.activeView() !== 'menu',
  );
  const mainColumnFrozen = createMemo(() =>
    rightToolsContentResizing()
    && rightToolsContentResizeMode() === 'live'
    && committedRightToolsWidth() != null,
  );
  const committedMainColumnWidth = createMemo(() => {
    const rightWidth = committedRightToolsWidth();
    const containerWidth = conversationSplitWidth();
    if (rightWidth == null || containerWidth <= 0) return null;
    return Math.max(0, containerWidth - rightWidth);
  });
  const mainColumnStyle = createMemo<JSX.CSSProperties | undefined>(() => {
    const width = committedMainColumnWidth();
    if (!mainColumnFrozen() || width == null) return undefined;
    return {
      width: `${width}px`,
      flex: '0 0 auto',
    };
  });
  const leftSidebarDragHandleLeft = createMemo(() =>
    Math.max(0, effectiveSidebarWidth() - (SPLIT_DRAG_HANDLE_WIDTH / 2)),
  );
  const rightToolsSessionId = createMemo(() =>
    sessionStore.activeSessionId,
  );
  const rightToolsWorkspacePath = createMemo(() =>
    sessionStore.activeSession?.cwd ?? null,
  );
  const rightToolsTerminalTitle = createMemo(() =>
    terminalTitleFromWorkspacePath(rightToolsWorkspacePath()),
  );
  const mainFrameStyle = createMemo<JSX.CSSProperties>(() => {
    return {
      'box-sizing': 'border-box',
      display: 'flex',
      flex: '1 1 0',
      'min-width': '0',
      'min-height': '0',
      overflow: 'hidden',
    };
  });
  const workspaceGridStyle = createMemo<JSX.CSSProperties>(() => {
    let columns = 'minmax(0, 1fr)';
    if (rightToolsDocked()) {
      columns = `minmax(0, 1fr) ${effectiveRightToolsWidth()}px`;
    }
    return { 'grid-template-columns': columns };
  });
  const rightToolsPaneStyle = createMemo<JSX.CSSProperties | undefined>(() => {
    if (!rightToolsVisible()) return undefined;
    if (!rightToolsOverlay()) return undefined;
    return { width: `${effectiveRightToolsWidth()}px` };
  });

  createEffect(() => {
    uiStore.setRightToolsOverlay(rightToolsOverlay());
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

  const cancelSidebarDragWidth = () => {
    if (sidebarDragFrame !== null) {
      cancelAnimationFrame(sidebarDragFrame);
      sidebarDragFrame = null;
    }
    pendingSidebarDragWidth = null;
    setSidebarDragWidth(null);
  };

  const cancelRightDragWidth = () => {
    if (rightDragFrame !== null) {
      cancelAnimationFrame(rightDragFrame);
      rightDragFrame = null;
    }
    pendingRightDragWidth = null;
    setRightDragWidth(null);
  };

  const cancelActiveDrag = () => {
    activeDragCancel?.();
  };

  const handleLeftSidebarDragStart = (e: MouseEvent) => {
    e.preventDefault();
    cancelActiveDrag();
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

    let finished = false;
    let cancelDrag = () => {};
    const finish = (commit: boolean) => {
      if (finished) return;
      finished = true;
      if (leftDragHandleEl) leftDragHandleEl.classList.remove(styles.leftDragHandleActive);
      if (layoutRef) layoutRef.classList.remove(styles.layoutDragging);
      if (commit) {
        const committedWidth = flushSidebarDragWidth(lastWidth);
        uiStore.setSidebarWidth(committedWidth);
        setSidebarDragWidth(null);
      } else {
        cancelSidebarDragWidth();
      }
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      window.removeEventListener('blur', cancelDrag);
      if (activeDragCancel === cancelDrag) activeDragCancel = null;
    };

    const onUp = () => {
      finish(true);
    };
    cancelDrag = () => finish(false);
    activeDragCancel = cancelDrag;

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    window.addEventListener('blur', cancelDrag);
  };

  const handleRightToolsDragStart = (e: MouseEvent) => {
    e.preventDefault();
    cancelActiveDrag();
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

    let finished = false;
    let cancelDrag = () => {};
    const finish = (commit: boolean) => {
      if (finished) return;
      finished = true;
      if (rightDragHandleEl) rightDragHandleEl.classList.remove(styles.rightDragHandleActive);
      if (layoutRef) layoutRef.classList.remove(styles.layoutDragging);
      if (commit) {
        const committedWidth = flushRightDragWidth(lastWidth);
        sidePanelStore.setPanelWidth(clampToolsDockWidth(committedWidth, containerWidth));
        setRightDragWidth(null);
      } else {
        cancelRightDragWidth();
      }
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      window.removeEventListener('blur', cancelDrag);
      if (activeDragCancel === cancelDrag) activeDragCancel = null;
    };

    const onUp = () => {
      finish(true);
    };
    cancelDrag = () => finish(false);
    activeDragCancel = cancelDrag;

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    window.addEventListener('blur', cancelDrag);
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
    cancelActiveDrag();
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
      data-right-tools-dragging={rightToolsDragActive() ? 'true' : undefined}
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
          flex: '1 1 0',
          'min-width': '0',
          'min-height': '0',
          position: 'relative',
          overflow: 'hidden',
        }}
        data-testid="workspace-frame"
      >
        <div
          class={styles.workspaceSplitGrid}
          style={workspaceGridStyle()}
          data-testid="workspace-split-grid"
        >
          <div class={styles.mainTitlebarCell} data-testid="workspace-titlebar-cell">
            <TitleBar
              onToggleSidebar={() => uiStore.toggleSidebar()}
              onNavigateBack={() => navigate(-1)}
              onNavigateForward={() => navigate(1)}
              onNewSession={handleNewSession}
              actionToolbarLeft={showPrimarySidebar() ? 'var(--space-2)' : undefined}
              showEnvironmentToggle={isConversationRoute()}
              environmentPanelOpen={uiStore.environmentPanelOpen}
              onToggleEnvironmentPanel={() => uiStore.toggleEnvironmentPanel()}
            />
          </div>
          <div
            class={styles.mainFrame}
            style={mainFrameStyle()}
            data-testid="workspace-content-frame"
          >
            <div
              class={styles.mainColumn}
              classList={{ [styles.mainColumnFrozen]: mainColumnFrozen() }}
              style={mainColumnStyle()}
              data-testid="workspace-main-column"
            >
              <main class={styles.content}>
                {props.children}
              </main>
            </div>
          </div>
          <Show when={rightToolsMounted()}>
            <div
              class={styles.rightToolsPane}
              classList={{
                [styles.rightToolsPaneOverlay]: rightToolsOverlay(),
                [styles.rightToolsPaneHidden]: !rightToolsVisible(),
              }}
              style={rightToolsPaneStyle()}
              data-testid="right-tools-dock"
            >
              <ToolDockToolbar
                terminalCwd={rightToolsWorkspacePath()}
                terminalTitle={rightToolsTerminalTitle()}
              />
              <div class={styles.rightToolsContent} data-testid="right-tools-content">
                <RightToolPanel
                  sessionId={rightToolsSessionId()}
                  workspacePath={rightToolsWorkspacePath()}
                  overlay={rightToolsOverlay()}
                  contentWidth={rightToolsContentWidth()}
                  resizeMode={rightToolsContentResizeMode()}
                  resizing={rightToolsContentResizing()}
                  visible={rightToolsVisible()}
                />
              </div>
            </div>
          </Show>
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
      <CommandPalette actions={paletteActions()} />
    </div>
  );
};
