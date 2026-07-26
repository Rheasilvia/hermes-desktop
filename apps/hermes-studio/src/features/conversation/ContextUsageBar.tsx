import type { Component } from 'solid-js';
import { Show } from 'solid-js';
import styles from './ContextUsageBar.module.css';

export interface ContextUsageProps {
  contextUsed: number | null;
  contextMax: number | null;
  contextPercent: number | null;
  costUsd: number | null;
  totalTokens: number | null;
}

function fmtK(n: number): string {
  if (n >= 10000) return `${Math.round(n / 1000)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function tokenLabel(n: number): string {
  return `${fmtK(n)} ${n === 1 ? 'token' : 'tokens'}`;
}

function costLabel(n: number): string {
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

export const ContextUsageBar: Component<ContextUsageProps> = (props) => {
  const tokenCount = () => props.totalTokens ?? 0;
  const hasContext = () => props.contextUsed !== null && props.contextMax !== null;
  const hasCost = () => props.costUsd !== null;

  return (
    <div class={styles.container} aria-label="Token usage">
      <span class={styles.metric}>{tokenLabel(tokenCount())}</span>
      <Show when={hasContext()}>
        <span class={styles.separator}>·</span>
        <span class={styles.metric}>
          {fmtK(props.contextUsed!)} / {fmtK(props.contextMax!)} context
        </span>
      </Show>
      <Show when={hasCost()}>
        <span class={styles.separator}>·</span>
        <span class={styles.metric}>{costLabel(props.costUsd!)}</span>
      </Show>
    </div>
  );
};
