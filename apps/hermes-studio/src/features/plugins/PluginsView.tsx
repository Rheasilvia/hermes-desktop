import type { Component } from 'solid-js';
import { Show, For, createEffect, createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import type { PluginHubResponse, PluginInstallResponse, PluginProviderOption, PluginRow } from '@/services/api/index.js';
import { api } from '@/services/api/index.js';
import { Tabs } from '@/ui/molecules/Tabs.js';
import { EmptyState } from '@/ui/molecules/EmptyState.js';
import { LoadingSpinner } from '@/ui/atoms/LoadingSpinner.js';
import { Icon } from '@/ui/atoms/Icon.js';
import styles from './PluginsView.module.css';

const TABS = [
  { id: 'installed', label: 'Installed', iconName: 'package' as const },
  { id: 'install', label: 'Install', iconName: 'store' as const },
  { id: 'providers', label: 'Providers', iconName: 'cpu' as const },
];

type ProviderKind = 'memory' | 'context';

interface ProviderDetail {
  key: string;
  kind: ProviderKind;
  label: string;
  option: PluginProviderOption;
  selected: boolean;
}

export const PluginsView: Component = () => {
  const [hub, setHub] = createSignal<PluginHubResponse | null>(null);
  const [loading, setLoading] = createSignal(true);
  const [pageError, setPageError] = createSignal('');
  const [activeTab, setActiveTab] = createSignal('installed');
  const [rowBusy, setRowBusy] = createSignal<Set<string>>(new Set());

  const [installId, setInstallId] = createSignal('');
  const [installForce, setInstallForce] = createSignal(false);
  const [installEnable, setInstallEnable] = createSignal(true);
  const [installBusy, setInstallBusy] = createSignal(false);
  const [installError, setInstallError] = createSignal('');
  const [installResult, setInstallResult] = createSignal<PluginInstallResponse | null>(null);

  const [memProvider, setMemProvider] = createSignal('');
  const [ctxEngine, setCtxEngine] = createSignal('');
  const [providersBusy, setProvidersBusy] = createSignal(false);
  const [expandedText, setExpandedText] = createSignal<Set<string>>(new Set());
  const [copiedCommand, setCopiedCommand] = createSignal('');
  const [providerKind, setProviderKind] = createSignal<ProviderKind>('memory');
  const [selectedProviderKey, setSelectedProviderKey] = createSignal('');

  const loadHub = async () => {
    try {
      const data = await api.plugins().getHub();
      setHub(data);
      if (data.providers.memory_provider && !memProvider()) {
        setMemProvider(data.providers.memory_provider);
      }
      if (data.providers.context_engine && !ctxEngine()) {
        setCtxEngine(data.providers.context_engine ?? '');
      }
      const contextOptions = [...data.providers.context_options];
      if (
        data.providers.context_engine &&
        !contextOptions.some((opt) => opt.name === data.providers.context_engine)
      ) {
        contextOptions.unshift({
          name: data.providers.context_engine,
          description: 'Built-in context engine used when no external context-engine plugin is selected.',
        });
      }
      const providerKeys = [
        ...data.providers.memory_options.map((opt) => providerKey('memory', opt.name)),
        ...contextOptions.map((opt) => providerKey('context', opt.name)),
      ];
      if (!selectedProviderKey() || !providerKeys.includes(selectedProviderKey())) {
        const preferredMemory = data.providers.memory_provider || data.providers.memory_options[0]?.name;
        const preferredContext = data.providers.context_engine || contextOptions[0]?.name;
        if (preferredMemory) {
          setProviderKind('memory');
          setSelectedProviderKey(providerKey('memory', preferredMemory));
        } else if (preferredContext) {
          setProviderKind('context');
          setSelectedProviderKey(providerKey('context', preferredContext));
        }
      }
      setPageError('');
    } catch (err) {
      setPageError((err as Error).message ?? 'Failed to load plugins.');
    } finally {
      setLoading(false);
    }
  };

  onMount(() => void loadHub());

  const setBusy = (name: string, busy: boolean) => {
    setRowBusy((prev) => {
      const next = new Set(prev);
      if (busy) next.add(name); else next.delete(name);
      return next;
    });
  };

  const withRowAction = async (name: string, action: () => Promise<unknown>) => {
    setBusy(name, true);
    try {
      await action();
      await loadHub();
    } catch (err) {
      setPageError((err as Error).message ?? 'Action failed.');
    } finally {
      setBusy(name, false);
    }
  };

  const handleRescan = async () => {
    setLoading(true);
    try {
      await api.plugins().rescan();
      await loadHub();
    } catch (err) {
      setPageError((err as Error).message ?? 'Rescan failed.');
      setLoading(false);
    }
  };

  const handleInstall = async () => {
    const id = installId().trim();
    if (!id) return;
    setInstallBusy(true);
    setInstallError('');
    setInstallResult(null);
    try {
      const result = await api.plugins().install({ identifier: id, force: installForce(), enable: installEnable() });
      setInstallId('');
      setInstallResult(result);
      await loadHub();
    } catch (err) {
      setInstallError((err as Error).message ?? 'Install failed.');
    } finally {
      setInstallBusy(false);
    }
  };

  const handleSaveProviders = async () => {
    setProvidersBusy(true);
    try {
      await api.plugins().saveProviders({
        memory_provider: memProvider() || null,
        context_engine: ctxEngine() || null,
      });
      await loadHub();
    } catch (err) {
      setPageError((err as Error).message ?? 'Failed to save providers.');
    } finally {
      setProvidersBusy(false);
    }
  };

  const handleRemove = async (plugin: PluginRow) => {
    if (!confirm(`Remove plugin "${plugin.name}"? This cannot be undone.`)) return;
    await withRowAction(plugin.name, () => api.plugins().remove(plugin.name));
  };

  const handleCopyCommand = async (command: string) => {
    try {
      await navigator.clipboard.writeText(command);
      setCopiedCommand(command);
      window.setTimeout(() => {
        if (copiedCommand() === command) setCopiedCommand('');
      }, 1600);
    } catch (err) {
      setPageError((err as Error).message ?? 'Failed to copy command.');
    }
  };

  const isTextExpanded = (key: string) => expandedText().has(key);

  const toggleText = (key: string) => {
    setExpandedText((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const providerKey = (kind: ProviderKind, name: string) => `${kind}:${name}`;

  const contextOptions = createMemo<PluginProviderOption[]>(() => {
    const h = hub();
    if (!h) return [];
    const current = h.providers.context_engine;
    if (!current || h.providers.context_options.some((opt) => opt.name === current)) {
      return h.providers.context_options;
    }
    return [
      {
        name: current,
        description: 'Built-in context engine used when no external context-engine plugin is selected.',
      },
      ...h.providers.context_options,
    ];
  });

  const selectedProvider = createMemo<ProviderDetail | null>(() => {
    const h = hub();
    if (!h) return null;
    const [kind, ...rest] = selectedProviderKey().split(':');
    const name = rest.join(':');
    if (kind !== 'memory' && kind !== 'context') return null;
    const options = kind === 'memory' ? h.providers.memory_options : contextOptions();
    const option = options.find((opt) => opt.name === name);
    if (!option) return null;
    return {
      key: providerKey(kind, option.name),
      kind,
      label: kind === 'memory' ? 'Memory Provider' : 'Context Engine',
      option,
      selected: kind === 'memory' ? memProvider() === option.name : ctxEngine() === option.name,
    };
  });

  const hasProviderOptions = () => {
    const h = hub();
    return Boolean((h?.providers.memory_options.length ?? 0) + contextOptions().length);
  };

  const visibleProviderOptions = createMemo(() => (
    providerKind() === 'memory' ? (hub()?.providers.memory_options ?? []) : contextOptions()
  ));

  const currentProviderName = createMemo(() => (
    providerKind() === 'memory' ? memProvider() : ctxEngine()
  ));

  const selectProviderKind = (kind: ProviderKind) => {
    setProviderKind(kind);
    const current = kind === 'memory' ? memProvider() : ctxEngine();
    const options = kind === 'memory' ? (hub()?.providers.memory_options ?? []) : contextOptions();
    const nextName = current || options[0]?.name || '';
    setSelectedProviderKey(nextName ? providerKey(kind, nextName) : '');
  };

  return (
    <div class={styles.view}>
      <div class={styles.headerRow}>
        <Tabs tabs={TABS} activeTab={activeTab()} onChange={setActiveTab} />
        <button
          class={styles.rescanBtn}
          onClick={() => void handleRescan()}
          disabled={loading()}
          type="button"
        >
          <Icon name="refresh-cw" size={14} />
          Rescan
        </button>
      </div>

      <Show when={pageError()}>
        <div class={styles.errorBanner}>{pageError()}</div>
      </Show>

      <div class={styles.content}>
        <Show
          when={!loading()}
          fallback={<div class={styles.loadingCenter}><LoadingSpinner size="md" /></div>}
        >
          {/* Installed tab */}
          <Show when={activeTab() === 'installed'}>
            <div class={styles.tabPanel}>
              <Show
                when={(hub()?.plugins.length ?? 0) > 0}
                fallback={
                  <EmptyState
                    iconName="package"
                    title="No plugins installed"
                    description="Use the Install tab to add a plugin."
                  />
                }
              >
                <div class={styles.installedPanel}>
                  <div class={styles.pluginList}>
                    <For each={hub()!.plugins}>
                      {(plugin) => {
                        const busy = () => rowBusy().has(plugin.name);
                        const descKey = () => `plugin:${plugin.name}`;
                        return (
                          <div class={styles.pluginCard}>
                            <div class={styles.pluginCardHeader}>
                              <div class={styles.pluginInfo}>
                                <span class={styles.pluginName}>{plugin.name}</span>
                                <span class={styles.pluginVersion}>v{plugin.version}</span>
                                <span class={`${styles.statusBadge} ${styles[`status_${plugin.runtime_status}`]}`}>
                                  {plugin.runtime_status}
                                </span>
                                <Show when={plugin.auth_required}>
                                  <span class={styles.authBadge}>
                                    <Icon name="lock" size={12} /> needs auth
                                  </span>
                                </Show>
                              </div>
                              <div class={styles.pluginActions}>
                                <Show when={plugin.runtime_status !== 'enabled'}>
                                  <button
                                    class={styles.actionBtn}
                                    disabled={busy()}
                                    onClick={() => void withRowAction(plugin.name, () => api.plugins().enable(plugin.name))}
                                    type="button"
                                  >
                                    Enable
                                  </button>
                                </Show>
                                <Show when={plugin.runtime_status === 'enabled'}>
                                  <button
                                    class={`${styles.actionBtn} ${styles.actionBtnSecondary}`}
                                    disabled={busy()}
                                    onClick={() => void withRowAction(plugin.name, () => api.plugins().disable(plugin.name))}
                                    type="button"
                                  >
                                    Disable
                                  </button>
                                </Show>
                                <Show when={plugin.can_update_git}>
                                  <button
                                    class={`${styles.actionBtn} ${styles.actionBtnSecondary}`}
                                    disabled={busy()}
                                    onClick={() => void withRowAction(plugin.name, () => api.plugins().update(plugin.name))}
                                    type="button"
                                  >
                                    Update
                                  </button>
                                </Show>
                                <Show when={plugin.has_dashboard_manifest}>
                                  <button
                                    class={`${styles.actionBtn} ${styles.actionBtnSecondary}`}
                                    disabled={busy()}
                                    onClick={() => void withRowAction(plugin.name, () => api.plugins().setVisibility(plugin.name, !plugin.user_hidden))}
                                    type="button"
                                  >
                                    {plugin.user_hidden ? 'Show sidebar' : 'Hide sidebar'}
                                  </button>
                                </Show>
                                <Show when={plugin.can_remove}>
                                  <button
                                    class={`${styles.actionBtn} ${styles.actionBtnDanger}`}
                                    disabled={busy()}
                                    onClick={() => void handleRemove(plugin)}
                                    type="button"
                                  >
                                    Remove
                                  </button>
                                </Show>
                              </div>
                            </div>
                            <ExpandableText
                              text={plugin.description}
                              expanded={isTextExpanded(descKey())}
                              onToggle={() => toggleText(descKey())}
                              className={styles.pluginDesc}
                              expandedClassName={styles.expandedText}
                            />
                            <Show when={plugin.auth_required}>
                              <div class={styles.authSection}>
                                <div class={styles.authLabelRow}>
                                  <span class={styles.authPrompt}>Run this command to authenticate:</span>
                                  <button
                                    class={styles.copyCommandBtn}
                                    type="button"
                                    onClick={() => void handleCopyCommand(plugin.auth_command)}
                                  >
                                    {copiedCommand() === plugin.auth_command ? 'Copied' : 'Copy'}
                                  </button>
                                </div>
                                <div class={styles.authCodeBlock}>
                                  <code class={styles.authCmd}>{plugin.auth_command}</code>
                                </div>
                              </div>
                            </Show>
                            <Show when={plugin.has_dashboard_manifest && plugin.dashboard_manifest}>
                              <div class={styles.manifestSection}>
                                <span class={styles.manifestLabel}>Dashboard extension</span>
                                <Show when={Array.isArray((plugin.dashboard_manifest as Record<string, unknown>)?.slots) && ((plugin.dashboard_manifest as Record<string, unknown>).slots as string[]).length > 0}>
                                  <span class={styles.slotsLabel}>Slots: {((plugin.dashboard_manifest as Record<string, unknown>).slots as string[]).join(', ')}</span>
                                </Show>
                              </div>
                            </Show>
                          </div>
                        );
                      }}
                    </For>
                  </div>
                </div>
              </Show>
            </div>
          </Show>

          {/* Install tab */}
          <Show when={activeTab() === 'install'}>
            <div class={styles.installForm}>
              <h3 class={styles.sectionTitle}>Install plugin</h3>
              <p class={styles.installHint}>
                Enter a GitHub repository (e.g. <code>owner/repo</code>) or a direct URL.
              </p>
              <div class={styles.installRow}>
                <input
                  class={styles.installInput}
                  type="text"
                  placeholder="owner/repo or URL"
                  value={installId()}
                  onInput={(e) => setInstallId(e.currentTarget.value)}
                  disabled={installBusy()}
                />
                <button
                  class={styles.primaryBtn}
                  disabled={installBusy() || !installId().trim()}
                  onClick={() => void handleInstall()}
                  type="button"
                >
                  {installBusy() ? 'Installing…' : 'Install'}
                </button>
              </div>
              <div class={styles.installOptions}>
                <label class={styles.checkLabel}>
                  <input
                    type="checkbox"
                    checked={installEnable()}
                    onChange={(e) => setInstallEnable(e.currentTarget.checked)}
                  />
                  Enable after install
                </label>
                <label class={styles.checkLabel}>
                  <input
                    type="checkbox"
                    checked={installForce()}
                    onChange={(e) => setInstallForce(e.currentTarget.checked)}
                  />
                  Force reinstall
                </label>
              </div>
              <Show when={installError()}>
                <div class={styles.errorBanner}>{installError()}</div>
              </Show>
              <Show when={installResult()}>
                {(result) => (
                  <div class={styles.installResultCard}>
                    <div class={styles.resultIcon}>
                      <Icon name="check-circle" size={18} />
                    </div>
                    <div class={styles.resultContent}>
                      <h4 class={styles.resultTitle}>
                        Installed {result().plugin_name || 'plugin'}
                      </h4>
                      <p class={styles.resultText}>
                        The plugin list has been refreshed with the latest backend data.
                      </p>
                      <Show when={(result().warnings?.length ?? 0) > 0}>
                        <p class={styles.resultWarning}>Warnings: {result().warnings!.join(' ')}</p>
                      </Show>
                      <Show when={(result().missing_env?.length ?? 0) > 0}>
                        <p class={styles.resultWarning}>Missing env: {result().missing_env!.join(', ')}</p>
                      </Show>
                    </div>
                    <button
                      class={`${styles.actionBtn} ${styles.actionBtnSecondary}`}
                      type="button"
                      onClick={() => setActiveTab('installed')}
                    >
                      View installed
                    </button>
                  </div>
                )}
              </Show>
            </div>
          </Show>

          {/* Providers tab */}
          <Show when={activeTab() === 'providers'}>
            <div class={styles.providersForm}>
              <div class={styles.providerToolbar}>
                <div class={styles.providerSummary}>
                  <span>Memory <strong>{memProvider() || 'Default'}</strong></span>
                  <span class={styles.providerSummaryDivider} />
                  <span>Context <strong>{ctxEngine() || 'Default'}</strong></span>
                </div>
                <button
                  class={styles.primaryBtn}
                  disabled={providersBusy()}
                  onClick={() => void handleSaveProviders()}
                  type="button"
                >
                  {providersBusy() ? 'Saving…' : 'Save providers'}
                </button>
              </div>

              <Show
                when={hasProviderOptions()}
                fallback={<p class={styles.dimText}>No provider integrations discovered.</p>}
              >
                <div class={styles.providerMasterDetail}>
                  <aside class={styles.providerIndex} aria-label="Provider index">
                    <div class={styles.providerTypeSwitch} role="tablist" aria-label="Provider type">
                      <button
                        class={`${styles.providerTypeBtn} ${providerKind() === 'memory' ? styles.providerTypeBtnActive : ''}`}
                        type="button"
                        role="tab"
                        aria-selected={providerKind() === 'memory'}
                        onClick={() => selectProviderKind('memory')}
                      >
                        Memory
                      </button>
                      <button
                        class={`${styles.providerTypeBtn} ${providerKind() === 'context' ? styles.providerTypeBtnActive : ''}`}
                        type="button"
                        role="tab"
                        aria-selected={providerKind() === 'context'}
                        onClick={() => selectProviderKind('context')}
                      >
                        Context
                      </button>
                    </div>

                    <div class={styles.providerIndexSection}>
                      <span class={styles.providerIndexTitle}>
                        {providerKind() === 'memory' ? 'Memory providers' : 'Context engines'}
                      </span>
                      <Show
                        when={visibleProviderOptions().length > 0}
                        fallback={<span class={styles.providerIndexEmpty}>None discovered</span>}
                      >
                        <For each={visibleProviderOptions()}>
                          {(opt) => {
                            const key = providerKey(providerKind(), opt.name);
                            return (
                              <button
                                class={`${styles.providerIndexItem} ${selectedProviderKey() === key ? styles.providerIndexItemActive : ''}`}
                                type="button"
                                onClick={() => setSelectedProviderKey(key)}
                              >
                                <span>{opt.name}</span>
                                <Show when={currentProviderName() === opt.name}>
                                  <span class={styles.providerCurrentDot}>Active</span>
                                </Show>
                              </button>
                            );
                          }}
                        </For>
                      </Show>
                    </div>
                  </aside>

                  <section class={styles.providerDetailPane}>
                    <Show when={selectedProvider()} fallback={<p class={styles.dimText}>Select a provider to inspect it.</p>}>
                      {(detail) => (
                        <div class={styles.providerDetailCard}>
                          <span class={styles.providerKindBadge}>{detail().label}</span>
                          <h4 class={styles.providerDetailTitle}>{detail().option.name}</h4>
                          <ExpandableText
                            text={detail().option.description}
                            expanded={isTextExpanded(`provider-detail:${detail().key}`)}
                            onToggle={() => toggleText(`provider-detail:${detail().key}`)}
                            className={styles.providerDetailDesc}
                            expandedClassName={styles.expandedText}
                          />
                          <div class={styles.providerDetailFooter}>
                            <span class={detail().selected ? styles.providerSelectedStatus : styles.providerAvailableStatus}>
                              {detail().selected ? 'In use' : 'Not in use'}
                            </span>
                            <button
                              class={detail().selected ? `${styles.actionBtn} ${styles.actionBtnSecondary}` : styles.primaryBtn}
                              type="button"
                              disabled={detail().selected}
                              onClick={() => {
                                if (detail().kind === 'memory') setMemProvider(detail().option.name);
                                else setCtxEngine(detail().option.name);
                              }}
                            >
                              {detail().selected ? 'Selected' : `Use as ${detail().kind === 'memory' ? 'memory provider' : 'context engine'}`}
                            </button>
                          </div>
                        </div>
                      )}
                    </Show>
                  </section>
                </div>
              </Show>
            </div>
          </Show>
        </Show>
      </div>
    </div>
  );
};

interface ExpandableTextProps {
  text?: string;
  expanded: boolean;
  onToggle: () => void;
  className: string;
  expandedClassName: string;
}

const ExpandableText: Component<ExpandableTextProps> = (props) => {
  let textEl: HTMLParagraphElement | undefined;
  const [canExpand, setCanExpand] = createSignal(false);
  const hasText = () => Boolean(props.text?.trim());

  const measureOverflow = () => {
    if (!textEl || props.expanded) return;
    setCanExpand(textEl.scrollHeight > textEl.clientHeight + 1);
  };

  onMount(() => {
    requestAnimationFrame(measureOverflow);
    window.addEventListener('resize', measureOverflow);
  });

  onCleanup(() => window.removeEventListener('resize', measureOverflow));

  createEffect(() => {
    props.text;
    props.expanded;
    requestAnimationFrame(measureOverflow);
  });

  return (
    <Show when={hasText()}>
      <div class={styles.expandableTextBlock}>
        <p
          ref={(el) => { textEl = el; }}
          class={`${props.className} ${props.expanded ? props.expandedClassName : ''}`}
        >
          {props.text}
        </p>
        <Show when={canExpand()}>
          <button class={styles.textToggleBtn} type="button" onClick={props.onToggle}>
            {props.expanded ? 'Show less' : 'Show more'}
          </button>
        </Show>
      </div>
    </Show>
  );
};
