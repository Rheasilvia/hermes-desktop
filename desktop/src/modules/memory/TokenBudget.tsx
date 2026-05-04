import type { Component } from 'solid-js';
import { createMemo } from 'solid-js';
import styles from './TokenBudget.module.css';

export interface TokenBudgetProps {
  used: number;
  total: number;
  label?: string;
}

function formatTokens(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return n.toString();
}

export const TokenBudget: Component<TokenBudgetProps> = (props) => {
  const percentage = createMemo((): number => {
    if (props.total === 0) return 0;
    return Math.round((props.used / props.total) * 1000) / 10;
  });

  const fillWidth = createMemo((): string => {
    return `${Math.min(percentage(), 100)}%`;
  });

  const fillClass = createMemo((): string => {
    const pct = percentage();
    if (pct >= 90) return `${styles.barFill} ${styles.danger}`;
    if (pct >= 70) return `${styles.barFill} ${styles.warning}`;
    return styles.barFill;
  });

  return (
    <div class={styles.tokenBudget}>
      <div class={styles.header}>
        <span class={styles.label}>{props.label ?? 'Token Budget'}</span>
        <span class={styles.percentage}>{percentage()}% used</span>
      </div>
      <div class={styles.barTrack}>
        <div class={fillClass()} style={{ width: fillWidth() }} />
      </div>
      <div class={styles.details}>
        <span class={styles.used}>{formatTokens(props.used)} used</span>
        <span class={styles.total}>{formatTokens(props.total)} total</span>
      </div>
    </div>
  );
};
