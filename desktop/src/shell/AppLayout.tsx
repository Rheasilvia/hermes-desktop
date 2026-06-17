import { Component, JSX, onMount, onCleanup, createSignal, Show, createMemo } from 'solid-js';
import { useNavigate, useLocation } from '@solidjs/router';
import { Sidebar } from '@/shell/Sidebar';
import { TitleBar } from '@/shell/TitleBar';
import { CommandPalette, buildDefaultActions } from '@/shell/CommandPalette';
import type { PaletteAction } from '@/shell/CommandPalette';
import { sessionStore } from '@/stores/session.js';
import { modelStore, modelsStore } from '@/stores/models.js';
import { uiStore } from '@/stores/ui.js';
import { initKeyboardShortcuts, destroyKeyboardShortcuts } from '@/services/keyboard.js';
import { loadState } from '@/services/api/state.js';
import { LoadingSpinner } from '@/ui/atoms/LoadingSpinner';
import { getGateway } from '@/stores/context.js';
import { setApprovalResponder, setSessionFocuser, teardownNativeNotifications } from '@/services/notifications/native-notifications.js';
import { cycleActiveReasoningEffort, updateActiveReasoningEffort } from './reasoning-actions.js';
import styles from './AppLayout.module.css';

interface AppLayoutProps {
  children?: JSX.Element;
}

export const AppLayout: Component<AppLayoutProps> = (props) => {
  const navigate = useNavigate();
  const location = useLocation();
  const [initializing, setInitializing] = createSignal(true);
  const isSettingsRoute = createMemo(() =>
    location.pathname === '/settings' || location.pathname.startsWith('/settings/'),
  );

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
    destroyKeyboardShortcuts();
  });

  return (
    <div class={styles.layout}>
      <Show when={initializing()}>
        <div style={{ display: 'flex', 'align-items': 'center', 'justify-content': 'center', height: '100vh', position: 'absolute', inset: '0', 'z-index': 'var(--z-overlay)', background: 'var(--color-background)' }}>
          <LoadingSpinner size="lg" label="Starting Hermes..." />
        </div>
      </Show>
      <TitleBar
        onToggleSidebar={() => uiStore.toggleSidebar()}
        onNavigateBack={() => navigate(-1)}
        onNavigateForward={() => navigate(1)}
        onNewSession={handleNewSession}
      />
      <div class={styles.contentRow}>
        <Show when={!isSettingsRoute() && !uiStore.sidebarCollapsed}>
          <Sidebar />
        </Show>
        <div class={styles.mainColumn}>
          <main class={styles.content}>
            {props.children}
          </main>
        </div>
      </div>
      <CommandPalette actions={paletteActions()} />
    </div>
  );
};
