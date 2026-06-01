import type { Component } from 'solid-js';
import { Show, onMount } from 'solid-js';
import { LoadingSpinner } from '@/ui/atoms/LoadingSpinner.js';
import { settingsStore } from '@/stores/settings.js';
import { GeneralTab } from './tabs/GeneralTab.js';
import styles from './SettingsView.module.css';

export const SettingsView: Component = () => {
  onMount(() => {
    settingsStore.loadConfig();
  });

  return (
    <div class={styles.container}>
      <Show when={settingsStore.isLoading && !settingsStore.config}>
        <div class={styles.loading}>
          <LoadingSpinner size="md" />
          <p>Loading configuration…</p>
        </div>
      </Show>

      <Show when={settingsStore.error}>
        <div class={styles.errorBanner}>
          {settingsStore.error}
        </div>
      </Show>

      <div class={styles.content}>
        <GeneralTab />
      </div>
    </div>
  );
};
