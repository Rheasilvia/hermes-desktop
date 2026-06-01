import type { Component } from 'solid-js';
import { Show, For, createMemo } from 'solid-js';
import { delegationStore, subagentList } from '@/stores/delegation.js';
import { Icon } from '@/ui/atoms/Icon.js';
import styles from './DelegationSidePanel.module.css';

const sortLabels: Record<typeof delegationStore.sortMode, string> = {
  'spawn-order': 'Spawn',
  'slowest': 'Slowest',
  'status': 'Status',
  'busiest': 'Busiest',
};

const filterLabels: Record<typeof delegationStore.filterMode, string> = {
  'all': 'All',
  'running': 'Running',
  'failed': 'Failed',
  'leaves': 'Leaves',
};

function statusIcon(status: string): import('@/ui/atoms/Icon.js').IconName {
  switch (status) {
    case 'running': return 'loader';
    case 'complete': return 'check-circle';
    case 'error': return 'alert-circle';
    case 'paused': return 'square';
    default: return 'cpu';
  }
}

function statusClass(status: string): string {
  switch (status) {
    case 'running': return styles.statusRunning;
    case 'complete': return styles.statusComplete;
    case 'error': return styles.statusError;
    case 'paused': return styles.statusPaused;
    default: return '';
  }
}

export const DelegationSidePanel: Component = () => {
  const filteredList = createMemo(() => {
    const list = subagentList();
    const mode = delegationStore.filterMode;
    if (mode === 'all') return list;
    if (mode === 'running') return list.filter((s) => s.status === 'running');
    if (mode === 'failed') return list.filter((s) => s.status === 'error');
    if (mode === 'leaves') {
      const hasChildren = new Set(list.map((s) => s.parent_id).filter(Boolean));
      return list.filter((s) => !hasChildren.has(s.subagent_id));
    }
    return list;
  });

  const sortedList = createMemo(() => {
    const list = [...filteredList()];
    const mode = delegationStore.sortMode;
    if (mode === 'spawn-order') return list;
    if (mode === 'slowest') return list.sort((a, b) => (b.duration_seconds ?? 0) - (a.duration_seconds ?? 0));
    if (mode === 'status') return list.sort((a, b) => a.status.localeCompare(b.status));
    if (mode === 'busiest') return list.sort((a, b) => (b.tool_count ?? 0) - (a.tool_count ?? 0));
    return list;
  });

  const runningCount = createMemo(() => subagentList().filter((s) => s.status === 'running').length);

  return (
    <div class={styles.panel}>
      <div class={styles.header}>
        <div class={styles.headerTitle}>
          <Icon name="users" size={16} />
          <span>Delegation</span>
          <span class={styles.badge}>{subagentList().length}</span>
        </div>
        <button
          type="button"
          class={`${styles.pauseBtn} ${delegationStore.paused ? styles.pauseBtnActive : ''}`}
          onClick={() => delegationStore.setPaused(!delegationStore.paused)}
          title={delegationStore.paused ? 'Resume delegation' : 'Pause delegation'}
        >
          <Icon name={delegationStore.paused ? 'play' : 'square'} size={14} />
          <span>{delegationStore.paused ? 'Resume' : 'Pause'}</span>
        </button>
      </div>

      <div class={styles.toolbar}>
        <div class={styles.toolbarGroup}>
          <span class={styles.toolbarLabel}>Sort</span>
          <div class={styles.toolbarButtons}>
            <For each={Object.entries(sortLabels)}>
              {([key, label]) => (
                <button
                  type="button"
                  class={`${styles.toolbarBtn} ${delegationStore.sortMode === key ? styles.toolbarBtnActive : ''}`}
                  onClick={() => delegationStore.setSortMode(key as typeof delegationStore.sortMode)}
                >
                  {label}
                </button>
              )}
            </For>
          </div>
        </div>
        <div class={styles.toolbarGroup}>
          <span class={styles.toolbarLabel}>Filter</span>
          <div class={styles.toolbarButtons}>
            <For each={Object.entries(filterLabels)}>
              {([key, label]) => (
                <button
                  type="button"
                  class={`${styles.toolbarBtn} ${delegationStore.filterMode === key ? styles.toolbarBtnActive : ''}`}
                  onClick={() => delegationStore.setFilterMode(key as typeof delegationStore.filterMode)}
                >
                  {label}
                </button>
              )}
            </For>
          </div>
        </div>
      </div>

      <Show when={runningCount() > 0}>
        <div class={styles.runningBanner}>
          <Icon name="loader" size={14} class={styles.spinning} />
          <span>{runningCount()} subagent{runningCount() === 1 ? '' : 's'} running</span>
        </div>
      </Show>

      <div class={styles.list}>
        <For each={sortedList()}>
          {(subagent) => (
            <div
              class={styles.card}
              style={{ 'margin-left': `${(subagent.depth ?? 0) * 16}px` }}
            >
              <div class={styles.cardHeader}>
                <span class={`${styles.statusDot} ${statusClass(subagent.status)}`}>
                  <Icon name={statusIcon(subagent.status)} size={12} />
                </span>
                <span class={styles.cardGoal} title={subagent.goal}>
                  {subagent.goal}
                </span>
                <span class={styles.cardModel}>{subagent.model}</span>
              </div>
              <div class={styles.cardMeta}>
                <span class={styles.metaId}>{subagent.subagent_id.slice(0, 8)}</span>
                {subagent.task_count != null && (
                  <span class={styles.metaItem}>Task {subagent.task_index ?? 0}/{subagent.task_count}</span>
                )}
                {subagent.tool_count != null && subagent.tool_count > 0 && (
                  <span class={styles.metaItem}>{subagent.tool_count} tools</span>
                )}
                {subagent.duration_seconds != null && (
                  <span class={styles.metaItem}>{subagent.duration_seconds.toFixed(1)}s</span>
                )}
                {subagent.cost_usd != null && subagent.cost_usd > 0 && (
                  <span class={styles.metaItem}>${subagent.cost_usd.toFixed(4)}</span>
                )}
              </div>
              {subagent.tool_preview && (
                <div class={styles.cardPreview}>{subagent.tool_preview}</div>
              )}
              {subagent.summary && (
                <div class={styles.cardSummary}>{subagent.summary}</div>
              )}
              {subagent.error_text && (
                <div class={styles.cardError}>{subagent.error_text}</div>
              )}
            </div>
          )}
        </For>

        {sortedList().length === 0 && (
          <div class={styles.emptyState}>
            <Icon name="users" size={32} class={styles.emptyIcon} />
            <span class={styles.emptyText}>No subagents yet</span>
            <span class={styles.emptySubtext}>Subagents will appear here when delegation starts.</span>
          </div>
        )}
      </div>
    </div>
  );
};
