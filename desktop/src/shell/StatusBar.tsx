import { Component } from 'solid-js';
import { useNavigate } from '@solidjs/router';
import { modelStore } from '@/stores/models.js';
import { sessionStore } from '@/stores/session.js';
import { uiStore } from '@/stores/ui.js';
import { cycleTheme } from '@/services/theme.js';
import { ROUTES } from '@/routes.js';
import styles from './StatusBar.module.css';

export const StatusBar: Component = () => {
  const navigate = useNavigate();

  const connectionLabel = (): string => {
    const state = uiStore.connectionState;
    switch (state) {
      case 'connected': return 'Connected';
      case 'connecting': return 'Connecting...';
      case 'disconnected': return 'Disconnected';
    }
  };

  const connectionClass = (): string => {
    const state = uiStore.connectionState;
    if (state === 'connected') return styles.indicator;
    return `${styles.indicator} ${styles.disconnected}`;
  };

  const modelLabel = (): string => {
    const provider = modelStore.activeProvider;
    const model = modelStore.activeModel;
    if (!provider || !model) return 'No model';
    return `${provider}/${model}`;
  };

  const sessionCount = (): number => sessionStore.sessions.length;

  const themeLabel = (): string => {
    const t = uiStore.theme;
    if (t === 'light') return '\u2600 Light';
    if (t === 'dark') return '\u263E Dark';
    return '\u2756 Earth';
  };

  const handleModelClick = () => {
    navigate(ROUTES.MODEL);
  };

  return (
    <div class={styles.statusBar}>
      <div class={styles.left}>
        <span class={connectionClass()} title={connectionLabel()} />
        <span>{connectionLabel()}</span>
      </div>
      <div class={styles.center}>
        <button
          class={styles.modelBtn}
          onClick={handleModelClick}
          type="button"
          title="Switch model"
        >
          {modelLabel()}
        </button>
      </div>
      <div class={styles.right}>
        <button
          type="button"
          class={styles.themeToggle}
          onClick={cycleTheme}
          title="Cycle theme"
        >
          {themeLabel()}
        </button>
        <span>{sessionCount()} session{sessionCount() !== 1 ? 's' : ''}</span>
      </div>
    </div>
  );
};
