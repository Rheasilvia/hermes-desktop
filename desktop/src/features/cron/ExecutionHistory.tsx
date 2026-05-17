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

const MOCK_HISTORY: HistoryEntry[] = [
  {
    id: 'exec_001',
    jobName: 'Daily standup report',
    status: 'ok',
    duration: '12.4s',
    timestamp: new Date(Date.now() - 3600000).toISOString(),
    message: 'Report delivered to origin',
  },
  {
    id: 'exec_002',
    jobName: 'Weekly code review',
    status: 'error',
    duration: '8.1s',
    timestamp: new Date(Date.now() - 7200000).toISOString(),
    message: 'API rate limit exceeded',
  },
  {
    id: 'exec_003',
    jobName: 'Daily standup report',
    status: 'ok',
    duration: '10.2s',
    timestamp: new Date(Date.now() - 86400000).toISOString(),
    message: 'Report delivered to origin',
  },
  {
    id: 'exec_004',
    jobName: 'Hourly health check',
    status: 'ok',
    duration: '2.3s',
    timestamp: new Date(Date.now() - 90000000).toISOString(),
    message: 'All systems healthy',
  },
  {
    id: 'exec_005',
    jobName: 'Nightly backup',
    status: 'ok',
    duration: '45.8s',
    timestamp: new Date(Date.now() - 172800000).toISOString(),
    message: 'Backup completed — 2.4 GB compressed',
  },
  {
    id: 'exec_006',
    jobName: 'Weekly code review',
    status: 'ok',
    duration: '15.6s',
    timestamp: new Date(Date.now() - 259200000).toISOString(),
    message: 'Summary delivered to local channel',
  },
];

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
  const entries = () => props.entries ?? MOCK_HISTORY;

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
