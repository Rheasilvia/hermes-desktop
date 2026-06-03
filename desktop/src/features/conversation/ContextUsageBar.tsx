import type { Component } from 'solid-js';
import { Show } from 'solid-js';
import styles from './ContextUsageBar.module.css';

export interface ContextUsageProps {
  contextUsed: number | null;
  contextMax: number | null;
  contextPercent: number | null;
  costUsd: number | null;
}

function fmtK(n: number): string {
  if (n >= 10000) return `${Math.round(n / 1000)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function getBarClass(percent: number): string {
  if (percent >= 95) return styles.barCritical;
  if (percent >= 80) return styles.barWarning;
  return styles.barNormal;
}

export const ContextUsageBar: Component<ContextUsageProps> = (props) => {
  const hasData = () => props.contextUsed !== null || props.costUsd !== null;

  return (
    <Show when={hasData()}>
      <div class={styles.container}>
        <Show when={props.contextPercent !== null}>
          <div class={styles.progressTrack}>
            <div
              class={`${styles.progressFill} ${getBarClass(props.contextPercent!)}`}
              style={{ width: `${Math.min(100, props.contextPercent!)}%` }}
            />
          </div>
        </Show>
        <div class={styles.labels}>
          <Show when={props.contextUsed !== null}>
            <span class={styles.label}>
              {fmtK(props.contextUsed!)}
              <Show when={props.contextMax !== null}>
                /{fmtK(props.contextMax!)}
              </Show>
              {' tok'}
            </span>
          </Show>
          <Show when={props.costUsd !== null && props.costUsd! > 0}>
            <span class={styles.label}>${props.costUsd!.toFixed(4)}</span>
          </Show>
        </div>
      </div>
    </Show>
  );
};
