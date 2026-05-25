import type { Component } from 'solid-js';
import { For, Show } from 'solid-js';
import { Badge } from '@/ui/atoms/Badge.js';
import styles from './ExecutionHistory.module.css';

export interface HistoryEntry {
  id: string;
  jobName: string;
  status: 'ok' | 'error';
  duration: string;
  timestamp: string;
  message?: string;
}

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${diffDays}d ago`;
}

interface ExecutionHistoryProps {
  entries?: HistoryEntry[];
}

export const ExecutionHistory: Component<ExecutionHistoryProps> = (props) => {
  const entries = () => props.entries ?? [];

  return (
    <div class={styles.history}>
      <div class={styles.header}>
        <span class={styles.colJob}>Job</span>
        <span class={styles.colStatus}>Status</span>
        <span class={styles.colDuration}>Duration</span>
        <span class={styles.colTime}>Time</span>
      </div>
      <For each={entries()}>
        {(entry) => (
          <div class={styles.row}>
            <span class={styles.colJob}>{entry.jobName}</span>
            <span class={styles.colStatus}>
              <Badge
                status={entry.status === 'ok' ? 'active' : 'error'}
                label={entry.status}
              />
            </span>
            <span class={styles.colDuration}>{entry.duration}</span>
            <span class={styles.colTime}>{formatTimestamp(entry.timestamp)}</span>
            <Show when={entry.message}>
              <div class={styles.message}>{entry.message}</div>
            </Show>
          </div>
        )}
      </For>
    </div>
  );
};
