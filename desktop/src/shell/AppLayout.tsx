import { Component, JSX, onMount, onCleanup, createSignal, Show } from 'solid-js';
import { useNavigate, useLocation } from '@solidjs/router';
import { Sidebar } from '@/shell/Sidebar';
import { CommandPalette, buildDefaultActions } from '@/shell/CommandPalette';
import type { PaletteAction } from '@/shell/CommandPalette';
import { sessionStore } from '@/stores/session.js';
import { modelStore, modelsStore } from '@/stores/models.js';
import { uiStore } from '@/stores/ui.js';
import { initKeyboardShortcuts, destroyKeyboardShortcuts } from '@/services/keyboard.js';
import { loadState } from '@/services/api/state.js';
import { LoadingSpinner } from '@/ui/atoms/LoadingSpinner';
import { getGateway } from '@/stores/context.js';
import { cycleActiveReasoningEffort, updateActiveReasoningEffort } from './reasoning-actions.js';
import styles from './AppLayout.module.css';

interface AppLayoutProps {
  children?: JSX.Element;
}

export const AppLayout: Component<AppLayoutProps> = (props) => {
  const navigate = useNavigate();
  const location = useLocation();
  const [initializing, setInitializing] = createSignal(true);

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
      onSwitchModel: () => navigate('/model'),
      onCycleReasoningEffort: cycleActiveReasoningEffort,
      onSetReasoningEffort: updateActiveReasoningEffort,
    });

  onMount(async () => {
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
        <div style={{ display: 'flex', 'align-items': 'center', 'justify-content': 'center', height: '100vh', position: 'absolute', inset: '0', 'z-index': '100', background: 'var(--color-background)' }}>
          <LoadingSpinner size="lg" label="Starting Hermes..." />
        </div>
      </Show>
      <div class={styles.contentRow}>
        <Sidebar />
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
