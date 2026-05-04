import { Component, JSX, onMount, onCleanup } from 'solid-js';
import { useNavigate } from '@solidjs/router';
import { Sidebar } from '@/components/Sidebar';
import { CommandPalette, buildDefaultActions } from '@/components/CommandPalette';
import type { PaletteAction } from '@/components/CommandPalette';
import { sessionStore } from '@/stores/session.js';
import { uiStore } from '@/stores/ui.js';
import { initKeyboardShortcuts, destroyKeyboardShortcuts } from '@/services/keyboard.js';
import styles from './AppLayout.module.css';

interface AppLayoutProps {
  children?: JSX.Element;
}

export const AppLayout: Component<AppLayoutProps> = (props) => {
  const navigate = useNavigate();

  const paletteActions = (): PaletteAction[] =>
    buildDefaultActions({
      onNavigate: (route: string) => navigate(route),
      onNewSession: () => {
        void sessionStore.createSession({}).then((meta) => {
          if (meta) navigate('/');
        });
      },
      onToggleSidebar: () => uiStore.toggleSidebar(),
      onCompressContext: () => {},
      onClearHistory: () => {},
      onSwitchModel: () => navigate('/model'),
    });

  onMount(() => {
    initKeyboardShortcuts({
      onToggleSidebar: () => uiStore.toggleSidebar(),
      onNavigate: (route: string) => navigate(route),
      onNewSession: () => {
        void sessionStore.createSession({}).then((meta) => {
          if (meta) navigate('/');
        });
      },
      onToggleCommandPalette: () => {},
    });
  });

  onCleanup(() => {
    destroyKeyboardShortcuts();
  });

  return (
    <div class={styles.layout}>
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
