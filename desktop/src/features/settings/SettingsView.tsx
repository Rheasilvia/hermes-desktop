import type { Component } from 'solid-js';
import { Show, Switch, Match, onMount } from 'solid-js';
import { LoadingSpinner } from '@/ui/atoms/LoadingSpinner.js';
import { settingsStore } from '@/stores/settings.js';
import { GeneralTab } from './tabs/GeneralTab.js';
import { AgentTab } from './tabs/AgentTab.js';
import { MemoryTab } from './tabs/MemoryTab.js';
import { SecurityTab } from './tabs/SecurityTab.js';
import { VoiceTab } from './tabs/VoiceTab.js';
import { BrowserTab } from './tabs/BrowserTab.js';
import { YamlTab } from './tabs/YamlTab.js';
import styles from './SettingsView.module.css';

interface SettingsTabDef {
  id: string;
  label: string;
}

const SETTINGS_TABS: SettingsTabDef[] = [
  { id: 'general', label: 'General' },
  { id: 'agent', label: 'Agent' },
  { id: 'memory', label: 'Memory' },
  { id: 'security', label: 'Security' },
  { id: 'voice', label: 'Voice' },
  { id: 'browser', label: 'Browser' },
  { id: 'yaml', label: 'YAML' },
];

export const SettingsView: Component = () => {
  onMount(() => {
    settingsStore.loadConfig();
  });

  const handleTabChange = (tabId: string) => {
    settingsStore.setActiveTab(tabId);
  };

  return (
    <div class={styles.container}>
      <aside class={styles.sidebar} role="tablist" aria-label="Settings sections">
        <h2 class={styles.sidebarTitle}>Settings</h2>
        <nav class={styles.nav}>
          {SETTINGS_TABS.map((tab) => (
            <button
              type="button"
              role="tab"
              aria-selected={settingsStore.activeTab === tab.id}
              class={`${styles.navItem} ${settingsStore.activeTab === tab.id ? styles.navItemActive : ''}`}
              onClick={() => handleTabChange(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </aside>

      <main class={styles.content} role="tabpanel">
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

        <Switch>
          <Match when={settingsStore.activeTab === 'general'}>
            <GeneralTab />
          </Match>
          <Match when={settingsStore.activeTab === 'agent'}>
            <AgentTab />
          </Match>
          <Match when={settingsStore.activeTab === 'memory'}>
            <MemoryTab />
          </Match>
          <Match when={settingsStore.activeTab === 'security'}>
            <SecurityTab />
          </Match>
          <Match when={settingsStore.activeTab === 'voice'}>
            <VoiceTab />
          </Match>
          <Match when={settingsStore.activeTab === 'browser'}>
            <BrowserTab />
          </Match>
          <Match when={settingsStore.activeTab === 'yaml'}>
            <YamlTab />
          </Match>
        </Switch>
      </main>
    </div>
  );
};
