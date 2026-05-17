import type { Component } from 'solid-js';
import { Show } from 'solid-js';
import type { CronJob } from '@/types/cron.js';
import { Badge } from '@/ui/atoms/Badge.js';
import { Button } from '@/ui/atoms/Button.js';
import { Icon } from '@/ui/atoms/Icon.js';
import { CronExpression } from './CronExpression.js';
import styles from './JobDetail.module.css';

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString();
}

function stateToBadgeStatus(state: CronJob['state']): 'active' | 'inactive' | 'pending' | 'error' {
  switch (state) {
    case 'scheduled': return 'active';
    case 'running': return 'pending';
    case 'paused': return 'inactive';
    case 'completed': return 'active';
  }
}

interface JobDetailProps {
  job: CronJob;
  onClose: () => void;
  onToggle?: (id: string, enabled: boolean) => void;
  onDelete?: (id: string) => void;
}

export const JobDetail: Component<JobDetailProps> = (props) => {
  return (
    <div class={styles.detail}>
      <div class={styles.header}>
        <div class={styles.titleRow}>
          <h3 class={styles.name}>{props.job.name}</h3>
          <Button variant="ghost" size="sm" onClick={props.onClose}>
            <Icon name="x" size={16} />
          </Button>
        </div>
        <div class={styles.badges}>
          <Badge
            status={props.job.enabled ? 'active' : 'inactive'}
            label={props.job.enabled ? 'enabled' : 'disabled'}
          />
          <Badge
            status={stateToBadgeStatus(props.job.state)}
            label={props.job.state}
          />
          <Show when={props.job.last_status === 'error'}>
            <Badge status="error" label="last run failed" />
          </Show>
        </div>
      </div>

      <div class={styles.section}>
        <h4 class={styles.sectionTitle}>Schedule</h4>
        <Show when={props.job.schedule.expr}>
          <CronExpression expression={props.job.schedule.expr!} />
        </Show>
        <p class={styles.scheduleDisplay}>{props.job.schedule_display}</p>
        <Show when={props.job.schedule.kind !== 'cron'}>
          <p class={styles.meta}>Kind: {props.job.schedule.kind}</p>
        </Show>
      </div>

      <div class={styles.section}>
        <h4 class={styles.sectionTitle}>Prompt</h4>
        <p class={styles.prompt}>{props.job.prompt}</p>
      </div>

      <div class={styles.section}>
        <h4 class={styles.sectionTitle}>Details</h4>
        <div class={styles.grid}>
          <div class={styles.field}>
            <span class={styles.label}>Delivery</span>
            <span class={styles.value}>
              {props.job.deliver === 'origin' ? <Icon name="radio-tower" size={14} /> : <Icon name="save" size={14} />} {props.job.deliver}
            </span>
          </div>
          <Show when={props.job.model}>
            <div class={styles.field}>
              <span class={styles.label}>Model</span>
              <span class={styles.value}>{props.job.model}</span>
            </div>
          </Show>
          <Show when={props.job.repeat.times !== null}>
            <div class={styles.field}>
              <span class={styles.label}>Repeat</span>
              <span class={styles.value}>
                {props.job.repeat.completed} / {props.job.repeat.times}
              </span>
            </div>
          </Show>
          <div class={styles.field}>
            <span class={styles.label}>Created</span>
            <span class={styles.value}>{formatDate(props.job.created_at)}</span>
          </div>
          <div class={styles.field}>
            <span class={styles.label}>Last run</span>
            <span class={styles.value}>{formatDate(props.job.last_run_at)}</span>
          </div>
          <div class={styles.field}>
            <span class={styles.label}>Next run</span>
            <span class={styles.value}>{formatDate(props.job.next_run_at)}</span>
          </div>
        </div>
      </div>

      <Show when={props.job.last_error}>
        <div class={styles.section}>
          <h4 class={styles.sectionTitle}>Last Error</h4>
          <p class={styles.error}>{props.job.last_error}</p>
        </div>
      </Show>

      <div class={styles.actions}>
        <Button
          variant={props.job.enabled ? 'secondary' : 'primary'}
          size="sm"
          onClick={() => props.onToggle?.(props.job.id, !props.job.enabled)}
        >
          {props.job.enabled ? 'Pause' : 'Resume'}
        </Button>
        <Button
          variant="danger"
          size="sm"
          onClick={() => props.onDelete?.(props.job.id)}
        >
          Delete
        </Button>
      </div>
    </div>
  );
};
