import type { Component } from 'solid-js';
import { For } from 'solid-js';
import type { UsageTotals, AnalyticsPeriod } from '@/types/analytics.js';
import styles from './UsageSummaryBar.module.css';

interface Props {
  totals: UsageTotals;
  period: AnalyticsPeriod;
  onPeriodChange: (p: AnalyticsPeriod) => void;
}

const PERIODS: AnalyticsPeriod[] = [7, 30, 90];

export const UsageSummaryBar: Component<Props> = (props) => {
  const fmt = (n: number) =>
    n >= 1_000_000
      ? `${(n / 1_000_000).toFixed(1)}M`
      : n >= 1_000
      ? `${(n / 1_000).toFixed(1)}K`
      : String(n);

  return (
    <div class={styles.bar}>
      <div class={styles.stats}>
        <div class={styles.stat}>
          <span class={styles.statValue}>{props.totals.total_sessions}</span>
          <span class={styles.statLabel}>Sessions</span>
        </div>
        <div class={styles.stat}>
          <span class={styles.statValue}>{fmt(props.totals.total_tokens)}</span>
          <span class={styles.statLabel}>Total tokens</span>
        </div>
        <div class={styles.stat}>
          <span class={styles.statValue}>${props.totals.total_cost_usd.toFixed(4)}</span>
          <span class={styles.statLabel}>Total cost</span>
        </div>
      </div>

      <div class={styles.periodPicker}>
        <For each={PERIODS}>
          {(p) => (
            <button
              class={`${styles.periodBtn} ${props.period === p ? styles.active : ''}`}
              onClick={() => props.onPeriodChange(p)}
            >
              {p}d
            </button>
          )}
        </For>
      </div>
    </div>
  );
};
