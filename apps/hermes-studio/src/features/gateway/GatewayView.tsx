import type { Component } from 'solid-js';
import { createSignal, onMount, Switch, Match, Show } from 'solid-js';
import { Tabs } from '@/ui/molecules/Tabs.js';
import { Button } from '@/ui/atoms/Button.js';
import { Modal } from '@/ui/molecules/Modal.js';
import type { Tab } from '@/ui/molecules/Tabs.js';
import { StatusDashboard } from './StatusDashboard.js';
import type { DashboardData } from './StatusDashboard.js';
import { MessageLog } from './MessageLog.js';
import type { LogEntry } from './MessageLog.js';
import { PlatformConfig } from './PlatformConfig.js';
import type { PlatformId } from './PlatformConfig.js';
import { SetupWizard } from './SetupWizard.js';
import styles from './GatewayView.module.css';

const PLATFORM_TABS: Tab[] = [
  { id: 'telegram', label: 'Telegram', iconName: 'send' },
  { id: 'discord', label: 'Discord', iconName: 'message-circle' },
  { id: 'slack', label: 'Slack', iconName: 'smartphone' },
  { id: 'whatsapp', label: 'WhatsApp', iconName: 'smartphone' },
  { id: 'signal', label: 'Signal', iconName: 'lock' },
  { id: 'homeassistant', label: 'Home Asst.', iconName: 'home' },
  { id: 'qqbot', label: 'QQ Bot', iconName: 'terminal' },
];

export const GatewayView: Component = () => {
  const [activePlatform, setActivePlatform] = createSignal<string>('telegram');
  const [showWizard, setShowWizard] = createSignal(false);
  const [enabledMap, setEnabledMap] = createSignal<Record<string, boolean>>({});

  onMount(() => {
    void 0;
  });

  const handleEnabledChange = (platform: string, value: boolean) => {
    setEnabledMap((prev) => ({ ...prev, [platform]: value }));
  };

  const currentDashboard = (): DashboardData =>
    ({ connected: false, uptime: '0m', messagesToday: 0, activeSessions: 0 });

  const currentMessages = (): LogEntry[] =>
    [];

  const currentEnabled = (): boolean =>
    enabledMap()[activePlatform()] ?? false;

  return (
    <div class={styles.gatewayView}>
      <div class={styles.toolbar}>
        <div class={styles.toolbarLeft}>
          <h2 class={styles.title}>Platform Gateway</h2>
        </div>
        <Button variant="primary" size="sm" onClick={() => setShowWizard(true)}>
          + Setup Wizard
        </Button>
      </div>

      <div class={styles.platformTabs}>
        <Tabs tabs={PLATFORM_TABS} activeTab={activePlatform()} onChange={setActivePlatform} />
      </div>

      <div class={styles.contentArea}>
        <div>
          <h4 class={styles.sectionLabel}>Status</h4>
          <StatusDashboard data={currentDashboard()} />
        </div>

        <div class={styles.configSection}>
          <Switch>
            <Match when={activePlatform() === 'telegram'}>
              <PlatformConfig platform="telegram" enabled={currentEnabled()} onEnabledChange={(v) => handleEnabledChange('telegram', v)} />
            </Match>
            <Match when={activePlatform() === 'discord'}>
              <PlatformConfig platform="discord" enabled={currentEnabled()} onEnabledChange={(v) => handleEnabledChange('discord', v)} />
            </Match>
            <Match when={activePlatform() === 'slack'}>
              <PlatformConfig platform="slack" enabled={currentEnabled()} onEnabledChange={(v) => handleEnabledChange('slack', v)} />
            </Match>
            <Match when={activePlatform() === 'whatsapp'}>
              <PlatformConfig platform="whatsapp" enabled={currentEnabled()} onEnabledChange={(v) => handleEnabledChange('whatsapp', v)} />
            </Match>
            <Match when={activePlatform() === 'signal'}>
              <PlatformConfig platform="signal" enabled={currentEnabled()} onEnabledChange={(v) => handleEnabledChange('signal', v)} />
            </Match>
            <Match when={activePlatform() === 'homeassistant'}>
              <PlatformConfig platform="homeassistant" enabled={currentEnabled()} onEnabledChange={(v) => handleEnabledChange('homeassistant', v)} />
            </Match>
            <Match when={activePlatform() === 'qqbot'}>
              <PlatformConfig platform="qqbot" enabled={currentEnabled()} onEnabledChange={(v) => handleEnabledChange('qqbot', v)} />
            </Match>
          </Switch>
        </div>

        <Show when={currentMessages().length > 0}>
          <div>
            <MessageLog messages={currentMessages()} />
          </div>
        </Show>
      </div>

      <Show when={showWizard()}>
        <Modal
          open={showWizard()}
          title="Platform Setup Wizard"
          onClose={() => setShowWizard(false)}
        >
          <SetupWizard open={showWizard()} onClose={() => setShowWizard(false)} />
        </Modal>
      </Show>
    </div>
  );
};
