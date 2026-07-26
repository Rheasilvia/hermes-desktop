import type { Component } from 'solid-js';
import { For, Show } from 'solid-js';
import { delegationStore } from '@/stores/delegation.js';
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

interface DelegationControlsProps {
  subagentCount: number;
}

export const DelegationControls: Component<DelegationControlsProps> = (props) => (
  <>
    <div class={styles.header}>
      <div class={styles.headerTitle}>
        <Icon name="users" size={16} />
        <span>Delegation</span>
        <span class={styles.badge}>{props.subagentCount}</span>
      </div>
      <button
        type="button"
        class={`${styles.pauseBtn} ${delegationStore.paused ? styles.pauseBtnActive : ''}`}
        onClick={() => void delegationStore.setPaused(!delegationStore.paused)}
        disabled={delegationStore.pausePending}
        title={delegationStore.paused ? 'Resume global subagent spawning' : 'Pause global subagent spawning'}
        aria-label={delegationStore.paused ? 'Resume global subagent spawning' : 'Pause global subagent spawning'}
      >
        <Icon name={delegationStore.pausePending ? 'loader' : delegationStore.paused ? 'play' : 'square'} size={14} />
        <span>{delegationStore.paused ? 'Global Resume' : 'Global Pause'}</span>
      </button>
    </div>

    <Show when={delegationStore.error}>
      <div class={styles.errorBanner}>
        <Icon name="alert-circle" size={14} />
        <span>{delegationStore.error}</span>
      </div>
    </Show>

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
  </>
);
