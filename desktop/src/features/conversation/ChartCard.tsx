import type { Component } from 'solid-js';
import { For, Show } from 'solid-js';
import type { ChartData } from '@/types/index.js';
import styles from './ChartCard.module.css';

interface ChartCardProps {
  data: ChartData;
  title?: string;
}

export const ChartCard: Component<ChartCardProps> = (props) => {
  const maxValue = () => {
    let max = 0;
    for (const ds of props.data.datasets) {
      for (const v of ds.values) {
        if (v > max) max = v;
      }
    }
    return max || 1;
  };

  /** Use the first dataset for bar rendering. */
  const dataset = () => props.data.datasets[0];

  return (
    <div class={styles.container}>
      <Show when={props.title}>
        <div class={styles.title}>{props.title}</div>
      </Show>
      <div class={styles.bars}>
        <For each={dataset()?.values ?? []}>
          {(value, _i) => (
            <div
              class={styles.bar}
              style={{
                height: `${(value / maxValue()) * 100}%`,
                'background-color': dataset()?.color ?? undefined,
              }}
            />
          )}
        </For>
      </div>
      <div class={styles.labels}>
        <For each={props.data.labels}>
          {(label) => <span class={styles.label}>{label}</span>}
        </For>
      </div>
    </div>
  );
};
