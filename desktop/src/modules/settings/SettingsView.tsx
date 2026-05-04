import type { Component } from 'solid-js';
import { Show, onMount, Switch, Match } from 'solid-js';
import { Tabs } from '@/components/Tabs.js';
import { Button } from '@/components/Button.js';
import { LoadingSpinner } from '@/components/LoadingSpinner.js';
import { settingsStore } from '@/stores/settings.js';
import { GeneralTab } from './tabs/GeneralTab.js';
import { AgentTab } from './tabs/AgentTab.js';
import { MemoryTab } from './tabs/MemoryTab.js';
import { SecurityTab } from './tabs/SecurityTab.js';
import { VoiceTab } from './tabs/VoiceTab.js';
import { BrowserTab } from './tabs/BrowserTab.js';
import { YamlTab } from './tabs/YamlTab.js';
import styles from './SettingsView.module.css';

const SETTINGS_TABS = [
  { id: 'general', label: 'General' },
  { id: 'agent', label: 'Agent', disabled: true },
  { id: 'memory', label: 'Memory', disabled: true },
  { id: 'security', label: 'Security', disabled: true },
  { id: 'voice', label: 'Voice', disabled: true },
  { id: 'browser', label: 'Browser', disabled: true },
  { id: 'yaml', label: 'YAML', disabled: true },
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
      <div class={styles.tabBar}>
        <Tabs
          tabs={SETTINGS_TABS}
          activeTab={settingsStore.activeTab}
          onChange={handleTabChange}
        />
      </div>

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
        <Switch>
          <Match when={settingsStore.activeTab === 'general'}>
            <GeneralTab />
          </Match>
        </Switch>

        <Show when={settingsStore.config}>
          <Switch>
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
        </Show>
      </div>
    </div>
  );
};
