import type { Component } from 'solid-js';
import { Show } from 'solid-js';
import type { ModelUsageStat } from '@/types/analytics.js';
import styles from './ModelUsageCard.module.css';

interface Props {
  stat: ModelUsageStat;
  isActive: boolean;
}

export const ModelUsageCard: Component<Props> = (props) => {
  const fmt = (n: number) =>
    n >= 1_000_000
      ? `${(n / 1_000_000).toFixed(1)}M`
      : n >= 1_000
      ? `${(n / 1_000).toFixed(1)}K`
      : String(n);

  const relativeTime = (iso: string | null | undefined) => {
    if (!iso) return null;
    const diff = Date.now() - new Date(iso).getTime();
    const hours = Math.floor(diff / 3_600_000);
    if (hours < 1) return 'just now';
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  };

  return (
    <div class={`${styles.card} ${props.isActive ? styles.active : ''}`}>
      <div class={styles.header}>
        <div class={styles.nameRow}>
          <span class={styles.model}>
            {props.stat.display_name ?? props.stat.model}
          </span>
          <Show when={props.isActive}>
            <span class={styles.activeBadge}>active</span>
          </Show>
        </div>
        <span class={styles.provider}>{props.stat.provider}</span>
      </div>

      <div class={styles.metrics}>
        <div class={styles.metric}>
          <span class={styles.metricValue}>{props.stat.session_count}</span>
          <span class={styles.metricLabel}>sessions</span>
        </div>
        <div class={styles.metric}>
          <span class={styles.metricValue}>{fmt(props.stat.total_tokens)}</span>
          <span class={styles.metricLabel}>tokens</span>
        </div>
        <div class={styles.metric}>
          <span class={styles.metricValue}>${props.stat.cost_usd.toFixed(4)}</span>
          <span class={styles.metricLabel}>cost</span>
        </div>
      </div>

      <div class={styles.tokenBreakdown}>
        <span class={styles.tokenIn}>↑ {fmt(props.stat.input_tokens)} in</span>
        <span class={styles.tokenOut}>↓ {fmt(props.stat.output_tokens)} out</span>
      </div>

      <Show when={props.stat.last_used_at}>
        <div class={styles.lastUsed}>
          Last used {relativeTime(props.stat.last_used_at)}
        </div>
      </Show>

      <div class={styles.caps}>
        <Show when={props.stat.capabilities.vision}>
          <span class={styles.cap} title="Vision">👁</span>
        </Show>
        <Show when={props.stat.capabilities.function_calling}>
          <span class={styles.cap} title="Tools">🔧</span>
        </Show>
      </div>
    </div>
  );
};
