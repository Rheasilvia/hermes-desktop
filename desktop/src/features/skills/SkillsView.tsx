import type { Component } from 'solid-js';
import { Show, For, createSignal, createMemo, onMount } from 'solid-js';
import type { SkillInfo, SkillsToolset } from '@/services/api/index.js';
import { api } from '@/services/api/index.js';
import { Tabs } from '@/ui/molecules/Tabs.js';
import { SearchInput } from '@/ui/molecules/SearchInput.js';
import { Pill } from '@/ui/atoms/Pill.js';
import { Toggle } from '@/ui/atoms/Toggle.js';
import { EmptyState } from '@/ui/molecules/EmptyState.js';
import { LoadingSpinner } from '@/ui/atoms/LoadingSpinner.js';
import { Icon } from '@/ui/atoms/Icon.js';
import type { IconName } from '@/ui/atoms/Icon.js';
import styles from './SkillsView.module.css';

const BADGES_LIMIT = 6;

const TOOLSET_ICONS: Record<string, IconName> = {
  web: 'globe',
  browser: 'monitor',
  terminal: 'terminal',
  file: 'folder-open',
  code_execution: 'code',
  vision: 'eye',
  video: 'layers',
  image_gen: 'palette',
  moa: 'layers',
  tts: 'radio',
  skills: 'zap',
  todo: 'clipboard-list',
  memory: 'brain',
  session_search: 'search',
  clarify: 'message-circle',
  delegation: 'shuffle',
  cronjob: 'clock',
  messaging: 'mail',
  rl: 'flask-conical',
  homeassistant: 'home',
  spotify: 'disc',
  discord: 'message-square',
  discord_admin: 'lock',
  yuanbao: 'bot',
};

const stripEmoji = (label: string) =>
  label.replace(/^[^\w\s]+\s*/, '').trim();

const TABS = [
  { id: 'skills', label: 'Skills', iconName: 'zap' as const },
  { id: 'toolsets', label: 'Toolsets', iconName: 'package' as const },
];

export const SkillsView: Component = () => {
  const [activeTab, setActiveTab] = createSignal('skills');

  // Skills tab state
  const [skills, setSkills] = createSignal<SkillInfo[]>([]);
  const [skillsLoading, setSkillsLoading] = createSignal(true);
  const [activeCategory, setActiveCategory] = createSignal('all');
  const [searchQuery, setSearchQuery] = createSignal('');

  const [expandedSkills, setExpandedSkills] = createSignal(new Set<string>());

  const toggleSkillDesc = (name: string) => {
    setExpandedSkills((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  };

  // Toolsets tab state
  const [toolsets, setToolsets] = createSignal<SkillsToolset[]>([]);
  const [toolsetsLoading, setToolsetsLoading] = createSignal(true);
  const [expandedToolsets, setExpandedToolsets] = createSignal(new Set<string>());

  const toggleExpanded = (name: string) => {
    setExpandedToolsets((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  };

  onMount(async () => {
    try {
      const [skillsRes, toolsetsRes] = await Promise.all([
        api.skills().listSkills(),
        api.skills().listToolsets(),
      ]);
      setSkills(skillsRes.items);
      setToolsets(toolsetsRes.items);
    } catch {
      setSkills([]);
      setToolsets([]);
    } finally {
      setSkillsLoading(false);
      setToolsetsLoading(false);
    }
  });

  // Derived: unique categories with counts
  const categories = createMemo(() => {
    const counts = new Map<string, number>();
    for (const s of skills()) {
      counts.set(s.category, (counts.get(s.category) ?? 0) + 1);
    }
    return Array.from(counts.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  });

  const filteredSkills = createMemo(() => {
    const cat = activeCategory();
    const q = searchQuery().toLowerCase();
    return skills().filter((s) => {
      const catMatch = cat === 'all' || s.category === cat;
      const qMatch =
        !q ||
        s.name.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q);
      return catMatch && qMatch;
    });
  });

  const handleToggleSkill = async (name: string, enabled: boolean) => {
    // Optimistic update — roll back on error
    setSkills((prev) =>
      prev.map((s) => (s.name === name ? { ...s, enabled } : s))
    );
    try {
      await api.skills().toggleSkill(name, enabled);
    } catch {
      setSkills((prev) =>
        prev.map((s) => (s.name === name ? { ...s, enabled: !enabled } : s))
      );
    }
  };

  return (
    <div class={styles.skillsView}>
      <div class={styles.tabsRow}>
        <Tabs tabs={TABS} activeTab={activeTab()} onChange={setActiveTab} />
      </div>

      <div class={styles.tabContent}>
        <Show when={activeTab() === 'skills'}>
          <Show
            when={!skillsLoading()}
            fallback={<div class={styles.loadingCenter}><LoadingSpinner size="md" /></div>}
          >
            <div class={styles.skillsLayout}>
              {/* Category index pane */}
              <nav class={styles.categoryPane}>
                <button
                  class={`${styles.categoryItem} ${activeCategory() === 'all' ? styles.categoryItemActive : ''}`}
                  onClick={() => setActiveCategory('all')}
                >
                  <span class={styles.categoryLabel}>All</span>
                  <span class={styles.categoryCount}>{skills().length}</span>
                </button>
                <For each={categories()}>
                  {([cat, count]) => (
                    <button
                      class={`${styles.categoryItem} ${activeCategory() === cat ? styles.categoryItemActive : ''}`}
                      onClick={() => setActiveCategory(cat)}
                    >
                      <span class={styles.categoryLabel}>{cat}</span>
                      <span class={styles.categoryCount}>{count}</span>
                    </button>
                  )}
                </For>
              </nav>

              {/* Skills list pane */}
              <div class={styles.skillsPane}>
                <div class={styles.skillsToolbar}>
                  <SearchInput
                    placeholder="Search skills…"
                    value={searchQuery()}
                    onChange={setSearchQuery}
                  />
                  <span class={styles.skillsCount}>
                    {filteredSkills().length} skill{filteredSkills().length !== 1 ? 's' : ''}
                  </span>
                </div>
                <div class={styles.skillsScroll}>
                  <Show
                    when={filteredSkills().length > 0}
                    fallback={
                      <EmptyState
                        iconName="zap"
                        title="No skills found"
                        description="Try a different category or search term"
                      />
                    }
                  >
                    <For each={filteredSkills()}>
                      {(skill) => (
                        <div class={styles.skillRow}>
                          <div class={styles.skillRowInfo}>
                            <div class={styles.skillRowName}>{skill.name}</div>
                            <div
                              class={`${styles.skillRowDesc} ${expandedSkills().has(skill.name) ? styles.skillRowDescExpanded : ''}`}
                              onClick={() => toggleSkillDesc(skill.name)}
                              title={skill.description}
                            >
                              {skill.description}
                            </div>
                          </div>
                          <div class={styles.skillRowActions}>
                            <Pill variant="secondary">{skill.category}</Pill>
                            <Toggle
                              checked={skill.enabled}
                              onChange={(v) => void handleToggleSkill(skill.name, v)}
                            />
                          </div>
                        </div>
                      )}
                    </For>
                  </Show>
                </div>
              </div>
            </div>
          </Show>
        </Show>

        <Show when={activeTab() === 'toolsets'}>
          <Show
            when={!toolsetsLoading()}
            fallback={<div class={styles.loadingCenter}><LoadingSpinner size="md" /></div>}
          >
            <div class={styles.toolsetsScroll}>
              <Show
                when={toolsets().length > 0}
                fallback={
                  <EmptyState
                    iconName="package"
                    title="No toolsets available"
                    description="Toolsets will appear here when the backend is connected"
                  />
                }
              >
                <div class={styles.toolsetsGrid}>
                  <For each={toolsets()}>
                    {(ts) => {
                      const isExpanded = () => expandedToolsets().has(ts.name);
                      const visibleTools = () =>
                        isExpanded() ? ts.tools : ts.tools.slice(0, BADGES_LIMIT);
                      return (
                        <div class={`${styles.toolsetCard} ${ts.enabled ? styles.toolsetCardActive : ''}`}>
                          <div class={styles.toolsetHeader}>
                            <div class={styles.toolsetTitleGroup}>
                              <Icon
                                name={TOOLSET_ICONS[ts.name] ?? 'package'}
                                size={15}
                                class={styles.toolsetIcon}
                              />
                              <span class={styles.toolsetLabel}>{stripEmoji(ts.label)}</span>
                            </div>
                            <div class={styles.toolsetBadges}>
                              <Show when={!ts.configured}>
                                <Pill variant="outline">Setup needed</Pill>
                              </Show>
                              <Pill variant={ts.enabled ? 'primary' : 'secondary'}>
                                {ts.enabled ? 'Active' : 'Inactive'}
                              </Pill>
                            </div>
                          </div>
                          <p class={styles.toolsetDesc}>{ts.description}</p>
                          <div class={styles.toolsetTools}>
                            <For each={visibleTools()}>
                              {(tool) => <span class={styles.toolBadge}>{tool}</span>}
                            </For>
                            <Show when={!isExpanded() && ts.tools.length > BADGES_LIMIT}>
                              <button
                                class={styles.toolBadgeToggle}
                                onClick={() => toggleExpanded(ts.name)}
                              >
                                +{ts.tools.length - BADGES_LIMIT} more
                              </button>
                            </Show>
                            <Show when={isExpanded()}>
                              <button
                                class={styles.toolBadgeToggle}
                                onClick={() => toggleExpanded(ts.name)}
                              >
                                collapse
                              </button>
                            </Show>
                          </div>
                        </div>
                      );
                    }}
                  </For>
                </div>
              </Show>
            </div>
          </Show>
        </Show>
      </div>
    </div>
  );
};
