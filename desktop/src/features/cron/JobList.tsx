import type { Component } from 'solid-js';
import { For, Show } from 'solid-js';
import type { CronJob } from '@/types/cron.js';
import { Badge } from '@/ui/atoms/Badge.js';
import { EmptyState } from '@/ui/molecules/EmptyState.js';
import { Icon } from '@/ui/atoms/Icon.js';
import { CronExpression } from './CronExpression.js';
import styles from './JobList.module.css';

function stateToBadgeStatus(state: CronJob['state']): 'active' | 'inactive' | 'pending' | 'error' {
  switch (state) {
    case 'scheduled': return 'active';
    case 'running': return 'pending';
    case 'paused': return 'inactive';
    case 'completed': return 'active';
  }
}

function formatRelative(iso: string | null): string {
  if (!iso) return '—';
  const date = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 0) {
    const absMins = Math.abs(diffMins);
    if (absMins < 60) return `in ${absMins}m`;
    const absHours = Math.abs(diffHours);
    if (absHours < 24) return `in ${absHours}h`;
    return `in ${Math.abs(diffDays)}d`;
  }
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${diffDays}d ago`;
}

interface JobListProps {
  jobs: CronJob[];
  onSelect: (id: string) => void;
  selectedId?: string | null;
}

export const JobList: Component<JobListProps> = (props) => {
  return (
    <Show
      when={props.jobs.length > 0}
      fallback={
        <EmptyState
          iconName="clock"
          title="No jobs found"
          description="No cron jobs match the current filter."
        />
      }
    >
      <div class={styles.list}>
        <For each={props.jobs}>
          {(job) => (
            <button
              class={`${styles.card} ${props.selectedId === job.id ? styles.selected : ''}`}
              type="button"
              onClick={() => props.onSelect(job.id)}
            >
              <div class={styles.cardHeader}>
                <span class={styles.name}>{job.name}</span>
                <div class={styles.badges}>
                  <Show when={!job.enabled}>
                    <Badge status="inactive" label="disabled" />
                  </Show>
                  <Badge status={stateToBadgeStatus(job.state)} label={job.state} />
                  <Show when={job.last_status === 'error'}>
                    <Badge status="error" label="error" />
                  </Show>
                </div>
              </div>
              <div class={styles.cardBody}>
                <Show when={job.schedule.expr}>
                  {(expr) => <CronExpression expression={expr()} />}
                </Show>
                <Show when={!job.schedule.expr}>
                  <span class={styles.scheduleDisplay}>{job.schedule_display}</span>
                </Show>
              </div>
              <div class={styles.cardFooter}>
                <span class={styles.timestamp}>
                  Last: {formatRelative(job.last_run_at)}
                </span>
                <span class={styles.timestamp}>
                  Next: {formatRelative(job.next_run_at)}
                </span>
                <Show when={job.deliver}>
                  <span class={styles.delivery}>
                    {job.deliver === 'origin' ? (
                      <Icon name="radio-tower" size={12} strokeWidth={1.5} />
                    ) : (
                      <Icon name="save" size={12} strokeWidth={1.5} />
                    )} {job.deliver}
                  </span>
                </Show>
                <Show when={job.repeat.times !== null}>
                  <span class={styles.repeat}>
                    {job.repeat.completed}/{job.repeat.times}
                  </span>
                </Show>
              </div>
            </button>
          )}
        </For>
      </div>
    </Show>
  );
};
