import type { Component } from 'solid-js';
import { Show, Switch, Match, onMount, createSignal } from 'solid-js';
import { LoadingSpinner } from '@/ui/atoms/LoadingSpinner.js';
import { configStore } from '@/stores/config.js';
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
  const [activeTab, setActiveTab] = createSignal('general');

  onMount(() => {
    configStore.loadConfig();
  });

  const handleTabChange = (tabId: string) => {
    setActiveTab(tabId);
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
              aria-selected={activeTab() === tab.id}
              class={`${styles.navItem} ${activeTab() === tab.id ? styles.navItemActive : ''}`}
              onClick={() => handleTabChange(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </aside>

      <main class={styles.content} role="tabpanel">
        <Show when={configStore.isLoading && !configStore.config}>
          <div class={styles.loading}>
            <LoadingSpinner size="md" />
            <p>Loading configuration…</p>
          </div>
        </Show>

        <Show when={configStore.error}>
          <div class={styles.errorBanner}>
            {configStore.error}
          </div>
        </Show>

        <Switch>
          <Match when={activeTab() === 'general'}>
            <GeneralTab />
          </Match>
          <Match when={activeTab() === 'agent'}>
            <AgentTab />
          </Match>
          <Match when={activeTab() === 'memory'}>
            <MemoryTab />
          </Match>
          <Match when={activeTab() === 'security'}>
            <SecurityTab />
          </Match>
          <Match when={activeTab() === 'voice'}>
            <VoiceTab />
          </Match>
          <Match when={activeTab() === 'browser'}>
            <BrowserTab />
          </Match>
          <Match when={activeTab() === 'yaml'}>
            <YamlTab />
          </Match>
        </Switch>
      </main>
    </div>
  );
};
