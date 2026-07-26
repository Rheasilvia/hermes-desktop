import type { JSX } from 'solid-js';
import { For, type Component } from 'solid-js';
import styles from './cards.module.css';

export interface KeyValueRow {
  label: string;
  value: JSX.Element | string;
}

/** Presentational label/value archetype for info cards (status, usage, model…). */
export const CardKeyValue: Component<{ rows: KeyValueRow[] }> = (props) => (
  <dl class={styles.kv}>
    <For each={props.rows}>
      {(row) => (
        <div class={styles.kvRow}>
          <dt class={styles.kvLabel}>{row.label}</dt>
          <dd class={styles.kvValue}>{row.value}</dd>
        </div>
      )}
    </For>
  </dl>
);
