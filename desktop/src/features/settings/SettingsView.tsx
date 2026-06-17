import type { Component, JSX } from 'solid-js';
import { Match, Show, Switch, createEffect, createMemo, createSignal, onMount } from 'solid-js';
import { useLocation, useNavigate } from '@solidjs/router';
import { ModuleLayout } from '@/shell/ModuleLayout.js';
import { SidebarNav } from '@/shell/SidebarNav';
import type { SidebarNavGroup } from '@/shell/SidebarNav';
import { LoadingSpinner } from '@/ui/atoms/LoadingSpinner.js';
import { Icon } from '@/ui/atoms/Icon.js';
import type { IconName } from '@/ui/atoms/Icon.js';
import { configStore } from '@/stores/config.js';
import { sessionStore } from '@/stores/session.js';
import { uiStore } from '@/stores/ui.js';
import { SessionsPageContent } from '@/features/sessions/SessionsPageContent.js';
import { ModelPageContent } from '@/features/model/ModelPageContent.js';
import { SkillsView } from '@/features/skills/SkillsView.js';
import { PluginsView } from '@/features/plugins/PluginsView.js';
import { McpView } from '@/features/mcp/index.js';
import { MemoryManagerView } from '@/features/memory/MemoryManagerView.js';
import { GatewayView } from '@/features/gateway/GatewayView.js';
import { CronView } from '@/features/cron/index.js';
import { ArchivedChatsView } from './ArchivedChatsView.js';
import { GeneralTab } from './tabs/GeneralTab.js';
import { AgentTab } from './tabs/AgentTab.js';
import { MemoryTab } from './tabs/MemoryTab.js';
import { SecurityTab } from './tabs/SecurityTab.js';
import { VoiceTab } from './tabs/VoiceTab.js';
import { BrowserTab } from './tabs/BrowserTab.js';
import { YamlTab } from './tabs/YamlTab.js';
import styles from './SettingsView.module.css';

type SettingsSectionId =
  | 'general'
  | 'agent'
  | 'memory-settings'
  | 'security'
  | 'voice'
  | 'browser'
  | 'yaml'
  | 'sessions'
  | 'model'
  | 'skills'
  | 'plugins'
  | 'mcp'
  | 'memory'
  | 'gateway'
  | 'cron'
  | 'archived-chats';

interface SettingsNavItem {
  id: SettingsSectionId;
  label: string;
  icon: IconName;
}

interface SettingsNavGroup {
  label: string;
  items: SettingsNavItem[];
}

const NAV_GROUPS: SettingsNavGroup[] = [
  {
    label: 'Personal',
    items: [
      { id: 'general', label: 'General', icon: 'settings' },
      { id: 'agent', label: 'Agent', icon: 'bot' },
      { id: 'memory-settings', label: 'Memory settings', icon: 'brain' },
      { id: 'security', label: 'Security', icon: 'lock' },
      { id: 'voice', label: 'Voice', icon: 'mic' },
      { id: 'browser', label: 'Browser', icon: 'monitor' },
      { id: 'yaml', label: 'YAML', icon: 'file-code' },
    ],
  },
  {
    label: 'Tools',
    items: [
      { id: 'sessions', label: 'Sessions', icon: 'clipboard-list' },
      { id: 'model', label: 'Model', icon: 'bot' },
      { id: 'skills', label: 'Skills', icon: 'zap' },
      { id: 'plugins', label: 'Plugins', icon: 'plug' },
      { id: 'mcp', label: 'MCP servers', icon: 'radio-tower' },
      { id: 'memory', label: 'Memory files', icon: 'brain' },
      { id: 'gateway', label: 'Gateway', icon: 'message-circle' },
      { id: 'cron', label: 'Cron', icon: 'clock' },
    ],
  },
  {
    label: 'Archived',
    items: [
      { id: 'archived-chats', label: 'Archived chats', icon: 'archive' },
    ],
  },
];

const VALID_SECTIONS = new Set<SettingsSectionId>(
  NAV_GROUPS.flatMap((group) => group.items.map((item) => item.id)),
);

function sectionPath(id: SettingsSectionId): string {
  return `/settings/${id}`;
}

function sectionFromPath(pathname: string): SettingsSectionId {
  const parts = pathname.replace(/^\/settings\/?/, '').split('/').filter(Boolean);
  const section = parts[0] as SettingsSectionId | undefined;
  return section && VALID_SECTIONS.has(section) ? section : 'general';
}

function sessionIdFromPath(pathname: string): string | null {
  const parts = pathname.replace(/^\/settings\/?/, '').split('/').filter(Boolean);
  return parts[0] === 'sessions' && parts[1] ? parts[1] : null;
}

const SettingsModule: Component<{
  title: string;
  description?: string;
  children: JSX.Element;
}> = (props) => (
  <ModuleLayout title={props.title} description={props.description}>
    {props.children}
  </ModuleLayout>
);

export const SettingsView: Component = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const [settingsSearch, setSettingsSearch] = createSignal('');

  onMount(() => {
    configStore.loadConfig();
  });

  const activeSection = () => sectionFromPath(location.pathname);
  const filteredNavGroups = createMemo(() => {
    const query = settingsSearch().trim().toLowerCase();
    return NAV_GROUPS.map((group) => {
      const groupMatches = group.label.toLowerCase().includes(query);
      const items = !query || groupMatches
        ? group.items
        : group.items.filter((item) => item.label.toLowerCase().includes(query));
      return { label: group.label, items };
    }).filter((group) => group.items.length > 0);
  });

  const settingsNavGroups = (): SidebarNavGroup[] =>
    filteredNavGroups().map((group) => ({
      label: group.label,
      items: group.items.map((item) => ({
        href: sectionPath(item.id),
        label: item.label,
        icon: item.icon,
        active: activeSection() === item.id,
      })),
    }));

  const handleBackToApp = async () => {
    const activeSessionId = sessionStore.activeSessionId;
    const target = activeSessionId && sessionStore.sessions.some((s) => s.id === activeSessionId)
      ? activeSessionId
      : sessionStore.sessions[0]?.id;

    if (target) {
      sessionStore.setActiveSession(target);
      navigate(`/conversation/${target}`);
      return;
    }

    const meta = await sessionStore.createSession({});
    if (meta) navigate(`/conversation/${meta.id}`);
  };

  createEffect(() => {
    if (location.pathname === '/settings') {
      navigate('/settings/general', { replace: true });
      return;
    }
    const sessionId = sessionIdFromPath(location.pathname);
    if (sessionId) {
      sessionStore.setActiveSession(sessionId);
    }
  });

  return (
    <div class={styles.container}>
      <aside
        class={styles.sidebar}
        aria-label="Settings sidebar"
        style={{ width: `${uiStore.sidebarWidth}px` }}
      >
        <div class={styles.sidebarChrome}>
          <button
            type="button"
            class={styles.backButton}
            onClick={() => void handleBackToApp()}
          >
            <Icon name="chevron-left" size={16} />
            <span>Back to App</span>
          </button>
          <div class={styles.searchBox}>
            <Icon name="search" size={14} class={styles.searchIcon} />
            <input
              aria-label="Search settings"
              class={styles.searchInput}
              type="search"
              placeholder="Search settings..."
              value={settingsSearch()}
              onInput={(event) => setSettingsSearch(event.currentTarget.value)}
            />
            <Show when={settingsSearch()}>
              <button
                type="button"
                class={styles.searchClear}
                aria-label="Clear settings search"
                onClick={() => setSettingsSearch('')}
              >
                <Icon name="x" size={11} />
              </button>
            </Show>
          </div>
        </div>
        <Show
          when={settingsNavGroups().length > 0}
          fallback={<div class={styles.emptySearch}>No settings found</div>}
        >
          <SidebarNav groups={settingsNavGroups()} ariaLabel="Settings sections" iconSize={15} />
        </Show>
      </aside>

      <main class={styles.content}>
        <Show when={configStore.isLoading && !configStore.config}>
          <div class={styles.loading}>
            <LoadingSpinner size="md" />
            <p>Loading configuration...</p>
          </div>
        </Show>

        <Show when={configStore.error}>
          <div class={styles.errorBanner}>
            {configStore.error}
          </div>
        </Show>

        <Switch>
          <Match when={activeSection() === 'general'}>
            <SettingsModule title="General" description="Application preferences">
              <GeneralTab />
            </SettingsModule>
          </Match>
          <Match when={activeSection() === 'agent'}>
            <SettingsModule title="Agent" description="Agent runtime behavior">
              <AgentTab />
            </SettingsModule>
          </Match>
          <Match when={activeSection() === 'memory-settings'}>
            <SettingsModule title="Memory settings" description="Memory behavior and provider settings">
              <MemoryTab />
            </SettingsModule>
          </Match>
          <Match when={activeSection() === 'security'}>
            <SettingsModule title="Security" description="Execution permissions and safety">
              <SecurityTab />
            </SettingsModule>
          </Match>
          <Match when={activeSection() === 'voice'}>
            <SettingsModule title="Voice" description="Speech and audio settings">
              <VoiceTab />
            </SettingsModule>
          </Match>
          <Match when={activeSection() === 'browser'}>
            <SettingsModule title="Browser" description="Browser automation settings">
              <BrowserTab />
            </SettingsModule>
          </Match>
          <Match when={activeSection() === 'yaml'}>
            <SettingsModule title="YAML" description="Raw configuration editor">
              <YamlTab />
            </SettingsModule>
          </Match>
          <Match when={activeSection() === 'sessions'}>
            <SettingsModule title="Sessions" description="Browse and manage desktop conversations">
              <SessionsPageContent />
            </SettingsModule>
          </Match>
          <Match when={activeSection() === 'model'}>
            <ModelPageContent />
          </Match>
          <Match when={activeSection() === 'skills'}>
            <SettingsModule title="Skills" description="Manage agent skills">
              <SkillsView />
            </SettingsModule>
          </Match>
          <Match when={activeSection() === 'plugins'}>
            <SettingsModule
              title="Plugins"
              description="Manage agent plugins, dashboard extensions, and provider integrations"
            >
              <PluginsView />
            </SettingsModule>
          </Match>
          <Match when={activeSection() === 'mcp'}>
            <SettingsModule title="MCP" description="Model Context Protocol servers">
              <McpView />
            </SettingsModule>
          </Match>
          <Match when={activeSection() === 'memory'}>
            <SettingsModule title="Memory" description="Per-user and per-project memory files">
              <MemoryManagerView />
            </SettingsModule>
          </Match>
          <Match when={activeSection() === 'gateway'}>
            <SettingsModule title="Gateway" description="Messaging platform integrations">
              <GatewayView />
            </SettingsModule>
          </Match>
          <Match when={activeSection() === 'cron'}>
            <SettingsModule title="Cron" description="Scheduled automation tasks">
              <CronView />
            </SettingsModule>
          </Match>
          <Match when={activeSection() === 'archived-chats'}>
            <SettingsModule title="Archived chats" description="Restore or delete archived desktop conversations">
              <ArchivedChatsView />
            </SettingsModule>
          </Match>
        </Switch>
      </main>
    </div>
  );
};
