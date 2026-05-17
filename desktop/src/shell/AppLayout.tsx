import { Component, JSX, onMount, onCleanup, createSignal, Show } from 'solid-js';
import { useNavigate, useLocation } from '@solidjs/router';
import { Sidebar } from '@/shell/Sidebar';
import { CommandPalette, buildDefaultActions } from '@/shell/CommandPalette';
import type { PaletteAction } from '@/shell/CommandPalette';
import { sessionStore } from '@/stores/session.js';
import { uiStore } from '@/stores/ui.js';
import { initKeyboardShortcuts, destroyKeyboardShortcuts } from '@/services/keyboard.js';
import { loadState } from '@/services/api/state.js';
import { LoadingSpinner } from '@/ui/atoms/LoadingSpinner';
import styles from './AppLayout.module.css';

interface AppLayoutProps {
  children?: JSX.Element;
}

export const AppLayout: Component<AppLayoutProps> = (props) => {
  const navigate = useNavigate();
  const location = useLocation();
  const [initializing, setInitializing] = createSignal(true);

  const paletteActions = (): PaletteAction[] =>
    buildDefaultActions({
      onNavigate: (route: string) => navigate(route),
      onNewSession: () => {
        navigate('/');
      },
      onToggleSidebar: () => uiStore.toggleSidebar(),
      onCompressContext: () => {},
      onClearHistory: () => {},
      onSwitchModel: () => navigate('/model'),
    });

  onMount(async () => {
    initKeyboardShortcuts({
      onToggleSidebar: () => uiStore.toggleSidebar(),
      onNavigate: (route: string) => navigate(route),
      onNewSession: () => {
        navigate('/');
      },
      onToggleCommandPalette: () => {},
    });

    // Load sessions and determine default route
    await sessionStore.loadSessions();
    const sessions = sessionStore.sessions;
    const isHome = location.pathname === '/' || location.pathname === '';

    if (sessions.length > 0 && isHome) {
      try {
        const state = await loadState();
        const lastSessionId = state.last_session_id;
        if (lastSessionId && sessions.some((s) => s.id === lastSessionId)) {
          navigate(`/conversation/${lastSessionId}`, { replace: true });
          setInitializing(false);
          return;
        }
      } catch {
        // state load failed, fall through
      }
      const mostRecent = sessions[0];
      navigate(`/conversation/${mostRecent.id}`, { replace: true });
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
