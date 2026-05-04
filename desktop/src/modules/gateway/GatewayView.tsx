import type { Component } from 'solid-js';
import { createSignal, onMount, Switch, Match, Show } from 'solid-js';
import { Tabs } from '@/components/Tabs.js';
import { Button } from '@/components/Button.js';
import { Modal } from '@/components/Modal.js';
import type { Tab } from '@/components/Tabs.js';
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

const MOCK_DASHBOARD: Record<string, DashboardData> = {
  telegram: { connected: true, uptime: '3d 14h', messagesToday: 127, activeSessions: 5 },
  discord: { connected: true, uptime: '7d 2h', messagesToday: 89, activeSessions: 3 },
  slack: { connected: false, uptime: '0m', messagesToday: 0, activeSessions: 0 },
  whatsapp: { connected: true, uptime: '1d 8h', messagesToday: 42, activeSessions: 2 },
  signal: { connected: false, uptime: '0m', messagesToday: 0, activeSessions: 0 },
  homeassistant: { connected: true, uptime: '12d 6h', messagesToday: 15, activeSessions: 1 },
  qqbot: { connected: false, uptime: '0m', messagesToday: 0, activeSessions: 0 },
};

const MOCK_MESSAGES: Record<string, LogEntry[]> = {
  telegram: [
    { time: '14:32', sender: 'Alice', platform: 'Telegram', content: 'Can you summarize the meeting notes?', status: 'read' },
    { time: '14:28', sender: 'Bob', platform: 'Telegram', content: 'Deploy the staging build when ready', status: 'delivered' },
    { time: '13:55', sender: 'Carol', platform: 'Telegram', content: 'What is the status of PR #42?', status: 'read' },
    { time: '13:12', sender: 'Alice', platform: 'Telegram', content: 'Please review the architecture doc', status: 'read' },
    { time: '12:45', sender: 'Dave', platform: 'Telegram', content: 'Connection timeout on API endpoint', status: 'error' },
    { time: '11:30', sender: 'Eve', platform: 'Telegram', content: 'Updated the cron schedule for nightly backup', status: 'read' },
  ],
  discord: [
    { time: '15:01', sender: 'dev-team', platform: 'Discord', content: 'Build passed on CI — all tests green', status: 'delivered' },
    { time: '14:50', sender: 'ops-channel', platform: 'Discord', content: 'Server CPU usage at 92% — investigate?', status: 'read' },
    { time: '14:15', sender: 'mod-bot', platform: 'Discord', content: 'New member joined: Frank', status: 'read' },
    { time: '13:40', sender: 'alerts', platform: 'Discord', content: 'Disk space low on /dev/sda1', status: 'error' },
    { time: '12:00', sender: 'dev-team', platform: 'Discord', content: 'Release v2.3.0 tagged and pushed', status: 'read' },
  ],
  slack: [
    { time: '09:00', sender: 'system', platform: 'Slack', content: 'Gateway disconnected — check bot token', status: 'error' },
  ],
  whatsapp: [
    { time: '16:10', sender: 'Grace', platform: 'WhatsApp', content: 'Send me the quarterly report', status: 'delivered' },
    { time: '15:30', sender: 'Henry', platform: 'WhatsApp', content: 'Meeting rescheduled to 4 PM', status: 'read' },
    { time: '14:00', sender: 'Grace', platform: 'WhatsApp', content: 'Check the latest test results', status: 'read' },
    { time: '11:20', sender: 'Ivan', platform: 'WhatsApp', content: 'New feature branch pushed', status: 'read' },
    { time: '10:45', sender: 'Henry', platform: 'WhatsApp', content: 'Deploy failed — rollback initiated', status: 'error' },
  ],
  signal: [
    { time: '09:00', sender: 'system', platform: 'Signal', content: 'Not configured', status: 'error' },
  ],
  homeassistant: [
    { time: '15:55', sender: 'sensor.living_room', platform: 'HA', content: 'Temperature: 22.4°C, Humidity: 45%', status: 'read' },
    { time: '14:20', sender: 'light.kitchen', platform: 'HA', content: 'State changed: off → on', status: 'delivered' },
    { time: '12:00', sender: 'automation.morning', platform: 'HA', content: 'Morning routine triggered', status: 'read' },
  ],
  qqbot: [
    { time: '09:00', sender: 'system', platform: 'QQ', content: 'Not configured', status: 'error' },
  ],
};

const MOCK_ENABLED: Record<string, boolean> = {
  telegram: true,
  discord: true,
  slack: false,
  whatsapp: true,
  signal: false,
  homeassistant: true,
  qqbot: false,
};

export const GatewayView: Component = () => {
  const [activePlatform, setActivePlatform] = createSignal<string>('telegram');
  const [showWizard, setShowWizard] = createSignal(false);
  const [enabledMap, setEnabledMap] = createSignal<Record<string, boolean>>({ ...MOCK_ENABLED });

  onMount(() => {
    void 0;
  });

  const handleEnabledChange = (platform: string, value: boolean) => {
    setEnabledMap((prev) => ({ ...prev, [platform]: value }));
  };

  const currentDashboard = (): DashboardData =>
    MOCK_DASHBOARD[activePlatform()] ?? { connected: false, uptime: '0m', messagesToday: 0, activeSessions: 0 };

  const currentMessages = (): LogEntry[] =>
    MOCK_MESSAGES[activePlatform()] ?? [];

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
