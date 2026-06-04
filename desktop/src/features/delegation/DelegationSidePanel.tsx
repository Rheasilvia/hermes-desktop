import type { Component } from 'solid-js';
import { Show, For, createMemo } from 'solid-js';
import { delegationStore, subagentList } from '@/stores/delegation.js';
import { Icon } from '@/ui/atoms/Icon.js';
import { DelegationControls } from './DelegationControls.js';
import { SubagentRow } from './SubagentRow.js';
import styles from './DelegationSidePanel.module.css';

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

  const parentIds = createMemo(() => {
    const ids = new Set<string>();
    for (const s of subagentList()) {
      if (s.parent_id) ids.add(s.parent_id);
    }
    return ids;
  });

  return (
    <div class={styles.panel}>
      <DelegationControls subagentCount={subagentList().length} />

      <Show when={runningCount() > 0}>
        <div class={styles.runningBanner}>
          <Icon name="loader" size={14} class={styles.spinning} />
          <span>{runningCount()} subagent{runningCount() === 1 ? '' : 's'} running</span>
        </div>
      </Show>

      <div class={styles.list} role="tree" aria-label="Subagent tree">
        <For each={sortedList()}>
          {(subagent) => (
            <SubagentRow
              subagent={subagent}
              hasChildren={parentIds().has(subagent.subagent_id)}
            />
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
