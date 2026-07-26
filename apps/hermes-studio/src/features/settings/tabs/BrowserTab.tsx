import type { Component } from 'solid-js';
import { configStore } from '@/stores/config.js';
import { ConfigField } from '../ConfigField.js';
import styles from './BrowserTab.module.css';

const BROWSER_PROVIDER_OPTIONS = [
  { value: 'browserbase', label: 'Browserbase (Cloud)' },
  { value: 'playwright', label: 'Playwright (Local)' },
  { value: 'builtin', label: 'Built-in' },
];

export const BrowserTab: Component = () => {
  const config = () => configStore.config;
  const browser = () => config()?.browser;

  const handleChange = (key: string, value: unknown) => {
    configStore.markDirty();
    configStore.saveConfig(key, value);
  };

  return (
    <div class={styles.tab}>
      <section class={styles.section}>
        <h3 class={styles.sectionTitle}>Browser Configuration</h3>
        <ConfigField
          label="Provider"
          description="Browser automation backend"
          type="select"
          value={browser()?.provider ?? 'builtin'}
          options={BROWSER_PROVIDER_OPTIONS}
          onChange={(v) => handleChange('browser.provider', v)}
        />
        <ConfigField
          label="Viewport Width"
          description="Browser viewport width in pixels"
          type="number"
          value={browser()?.viewport_width ?? 1280}
          min={320}
          max={3840}
          onChange={(v) => handleChange('browser.viewport_width', v)}
        />
        <ConfigField
          label="Viewport Height"
          description="Browser viewport height in pixels"
          type="number"
          value={browser()?.viewport_height ?? 720}
          min={240}
          max={2160}
          onChange={(v) => handleChange('browser.viewport_height', v)}
        />
      </section>

      <section class={styles.section}>
        <h3 class={styles.sectionTitle}>Terminal Backend</h3>
        <ConfigField
          label="Backend"
          description="Terminal execution environment"
          type="text"
          value={config()?.terminal?.backend ?? 'local'}
          placeholder="local, docker, ssh"
          onChange={(v) => handleChange('terminal.backend', v)}
        />
        <ConfigField
          label="Working Directory"
          description="Default working directory for terminal commands"
          type="text"
          value={config()?.terminal?.cwd ?? ''}
          placeholder="/home/user/projects"
          onChange={(v) => handleChange('terminal.cwd', v)}
        />
      </section>
    </div>
  );
};
