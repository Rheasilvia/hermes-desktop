import type { Component } from 'solid-js';
import { Show, For, Switch, Match, createSignal, createMemo, onMount } from 'solid-js';
import type { ToolEntry } from '@/types/tool.js';
import type { SkillDetailData } from './SkillDetail.js';
import { getGateway } from '@/stores/context.js';
import { Tabs } from '@/components/Tabs.js';
import { SearchInput } from '@/components/SearchInput.js';
import { Button } from '@/components/Button.js';
import { Pill } from '@/components/Pill.js';
import { EmptyState } from '@/components/EmptyState.js';
import { LoadingSpinner } from '@/components/LoadingSpinner.js';
import { Toggle } from '@/components/Toggle.js';
import { ToolList } from './ToolList.js';
import { SkillsHub } from './SkillsHub.js';
import { ToolsetsGrid } from './ToolsetsGrid.js';
import { SkillDetail } from './SkillDetail.js';
import type { IconName } from '@/components/Icon.js';
import styles from './SkillsView.module.css';

interface HubSkill {
  name: string;
  description: string;
  icon: IconName;
  author: string;
  category: string;
  installed: boolean;
}

interface ToolsetCard {
  name: string;
  icon: IconName;
  tools: string[];
  enabled: boolean;
  category: string;
}

interface EnabledSkill {
  name: string;
  description: string;
  category: string;
  icon: IconName;
  enabled: boolean;
}

const TABS = [
  { id: 'tools', label: 'Tools', iconName: 'wrench' as const },
  { id: 'hub', label: 'Skills Hub', iconName: 'store' as const },
  { id: 'toolsets', label: 'Toolsets', iconName: 'package' as const },
  { id: 'enabled', label: 'Enabled', iconName: 'check-circle' as const },
];

const MOCK_HUB_SKILLS: HubSkill[] = [
  { name: 'Task Master', description: 'Advanced task management with priorities, deadlines, and recurring tasks.', icon: 'file-check', author: 'Hermes Team', category: 'Productivity', installed: true },
  { name: 'Git Wizard', description: 'Smart Git operations including interactive rebase, conflict resolution, and branch management.', icon: 'shuffle', author: 'Hermes Team', category: 'Development', installed: true },
  { name: 'Email Assistant', description: 'Draft, review, and manage emails with tone analysis and template support.', icon: 'mail', author: 'Hermes Team', category: 'Communication', installed: false },
  { name: 'Code Reviewer', description: 'Automated code review with style checks, security scanning, and best practices.', icon: 'search', author: 'Community', category: 'Development', installed: true },
  { name: 'Notion Sync', description: 'Two-way sync between Hermes memory and Notion workspaces.', icon: 'book', author: 'Community', category: 'Productivity', installed: false },
  { name: 'Slack Bot', description: 'Post messages, manage channels, and search conversations in Slack workspaces.', icon: 'message-circle', author: 'Hermes Team', category: 'Communication', installed: false },
];

const MOCK_TOOLSETS: ToolsetCard[] = [
  { name: 'File Operations', icon: 'layers', tools: ['file_read', 'file_write', 'file_search', 'file_patch'], enabled: true, category: 'System' },
  { name: 'Web Tools', icon: 'globe', tools: ['web_search', 'web_fetch', 'browser_navigate', 'browser_snapshot'], enabled: true, category: 'Research' },
  { name: 'Code Tools', icon: 'code', tools: ['execute_code', 'terminal', 'delegate'], enabled: true, category: 'Development' },
  { name: 'System Tools', icon: 'disc', tools: ['process_list', 'process_kill', 'system_info'], enabled: true, category: 'System' },
  { name: 'Media Tools', icon: 'palette', tools: ['image_generate', 'image_edit', 'tts', 'stt'], enabled: false, category: 'Custom' },
  { name: 'Communication', icon: 'radio-tower', tools: ['email_send', 'slack_post', 'telegram_send'], enabled: true, category: 'Communication' },
  { name: 'Browser', icon: 'monitor', tools: ['browser_navigate', 'browser_click', 'browser_snapshot', 'browser_type'], enabled: true, category: 'Development' },
  { name: 'Delegation', icon: 'handshake', tools: ['delegate', 'batch_run', 'parallel_exec'], enabled: true, category: 'Productivity' },
  { name: 'Memory', icon: 'brain', tools: ['memory_save', 'memory_search', 'memory_recall'], enabled: true, category: 'Productivity' },
];

const MOCK_ENABLED_SKILLS: EnabledSkill[] = [
  { name: 'Code Review', description: 'Automated code review with style and security checks', category: 'Development', icon: 'search', enabled: true },
  { name: 'Bug Hunter', description: 'Systematic debugging with root-cause analysis', category: 'Development', icon: 'bug', enabled: true },
  { name: 'Doc Writer', description: 'Generate documentation from code and comments', category: 'Productivity', icon: 'file-text', enabled: true },
  { name: 'Deep Research', description: 'Multi-source research with citation tracking', category: 'Research', icon: 'flask-conical', enabled: true },
  { name: 'Slack Summarizer', description: 'Summarize Slack conversations and channels', category: 'Communication', icon: 'message-circle', enabled: false },
  { name: 'Shell Expert', description: 'Advanced shell command generation and explanation', category: 'System', icon: 'code', enabled: true },
];

const MOCK_SKILL_DETAIL: SkillDetailData = {
  name: 'Code Review',
  icon: 'search',
  category: 'Development',
  description: 'Automated code review',
  instructions: 'Analyze code changes for style issues, security vulnerabilities, performance problems, and best practice violations. Provide actionable suggestions with severity ratings.',
  prerequisites: ['Git repository access', 'Code analysis tools installed', 'Style guide configuration'],
  inputSchema: 'interface ReviewInput {\n  diff: string;\n  language?: string;\n  focus?: ("style" | "security" | "performance")[];\n}',
  outputSchema: 'interface ReviewOutput {\n  findings: Finding[];\n  summary: string;\n  score: number;\n}',
  enabled: true,
  confidence: 92,
};

export const SkillsView: Component = () => {
  const [activeTab, setActiveTab] = createSignal('tools');
  const [tools, setTools] = createSignal<ToolEntry[]>([]);
  const [enabledTools, setEnabledTools] = createSignal<Set<string>>(new Set());
  const [hubSkills, setHubSkills] = createSignal<HubSkill[]>(MOCK_HUB_SKILLS);
  const [searchQuery, setSearchQuery] = createSignal('');
  const [selectedEnabledSkill, setSelectedEnabledSkill] = createSignal<string | null>(null);
  const [loading, setLoading] = createSignal(true);

  onMount(async () => {
    const gateway = getGateway();
    if (gateway) {
      try {
        const toolList = await gateway.tools.list();
        setTools(toolList);
        setEnabledTools(new Set(toolList.map((t) => t.name)));
      } catch {
        setTools([]);
      }
    }
    setLoading(false);
  });

  const filteredTools = createMemo(() => {
    const q = searchQuery().toLowerCase();
    if (!q) return tools();
    return tools().filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.schema.description.toLowerCase().includes(q) ||
        t.toolset.toLowerCase().includes(q)
    );
  });

  const handleToolToggle = (toolName: string, enabled: boolean) => {
    setEnabledTools((prev) => {
      const next = new Set(prev);
      if (enabled) {
        next.add(toolName);
      } else {
        next.delete(toolName);
      }
      return next;
    });
  };

  const handleHubInstall = (name: string) => {
    setHubSkills((prev) =>
      prev.map((s) => (s.name === name ? { ...s, installed: true } : s))
    );
  };

  const handleHubUninstall = (name: string) => {
    setHubSkills((prev) =>
      prev.map((s) => (s.name === name ? { ...s, installed: false } : s))
    );
  };

  const handleToolsetToggle = (name: string, enabled: boolean) => {
    void name;
    void enabled;
  };

  const handleToolsetSelect = (name: string) => {
    void name;
  };

  const selectedSkillDetail = createMemo((): SkillDetailData | null => {
    const sel = selectedEnabledSkill();
    if (!sel) return null;
    const skill = MOCK_ENABLED_SKILLS.find((s) => s.name === sel);
    if (!skill) return null;
    return {
      ...MOCK_SKILL_DETAIL,
      name: skill.name,
      icon: skill.icon,
      category: skill.category,
      description: skill.description,
      enabled: skill.enabled,
    };
  });

  return (
    <div class={styles.skillsView}>
      <div class={styles.tabsRow}>
        <Tabs tabs={TABS} activeTab={activeTab()} onChange={setActiveTab} />
      </div>

      <div class={styles.tabContent}>
        <Switch>
          <Match when={activeTab() === 'tools'}>
            <div class={styles.toolsTab}>
              <div class={styles.toolsSearchRow}>
                <SearchInput
                  placeholder="Search tools..."
                  value={searchQuery()}
                  onChange={setSearchQuery}
                />
                <span class={styles.toolsCount}>
                  {filteredTools().length} tool{filteredTools().length !== 1 ? 's' : ''}
                </span>
              </div>
              <Show
                when={!loading()}
                fallback={<LoadingSpinner size="md" />}
              >
                <Show
                  when={filteredTools().length > 0}
                  fallback={
                    <EmptyState
                      iconName="wrench"
                      title="No tools found"
                      description="Try adjusting your search query"
                    />
                  }
                >
                  <ToolList
                    tools={filteredTools()}
                    enabledTools={enabledTools()}
                    onToggle={handleToolToggle}
                  />
                </Show>
              </Show>
            </div>
          </Match>

          <Match when={activeTab() === 'hub'}>
            <div class={styles.hubTab}>
              <div class={styles.hubHeader}>
                <div class={styles.hubTitle}>Skills Hub</div>
                <div class={styles.hubSubtitle}>
                  Discover and install community skills to extend your agent
                </div>
              </div>
              <SkillsHub
                skills={hubSkills()}
                onInstall={handleHubInstall}
                onUninstall={handleHubUninstall}
              />
            </div>
          </Match>

          <Match when={activeTab() === 'toolsets'}>
            <ToolsetsGrid
              toolsets={MOCK_TOOLSETS}
              onToggle={handleToolsetToggle}
              onSelect={handleToolsetSelect}
            />
          </Match>

          <Match when={activeTab() === 'enabled'}>
            <div class={styles.enabledLayout}>
              <div class={styles.enabledMain}>
                <div class={styles.enabledToolbar}>
                  <SearchInput
                    placeholder="Search skills..."
                    value=""
                    onChange={() => {}}
                  />
                  <Button size="sm" variant="primary">
                    + Add Custom
                  </Button>
                </div>
                <div class={styles.enabledGrid}>
                  <For each={MOCK_ENABLED_SKILLS}>
                    {(skill) => (
                      <div
                        class={`${styles.enabledCard} ${selectedEnabledSkill() === skill.name ? styles.enabledCardSelected : ''}`}
                        onClick={() => setSelectedEnabledSkill(skill.name)}
                      >
                        <div class={styles.enabledCardInfo}>
                          <div class={styles.enabledCardName}>{skill.name}</div>
                          <div class={styles.enabledCardMeta}>
                            <Pill variant="secondary">{skill.category}</Pill>
                          </div>
                          <div class={styles.enabledCardDesc}>{skill.description}</div>
                        </div>
                        <Toggle
                          checked={skill.enabled}
                          onChange={() => {}}
                        />
                      </div>
                    )}
                  </For>
                </div>
              </div>
              <SkillDetail
                skill={selectedSkillDetail()}
                onClose={() => setSelectedEnabledSkill(null)}
                onToggle={() => {}}
              />
            </div>
          </Match>
        </Switch>
      </div>
    </div>
  );
};
