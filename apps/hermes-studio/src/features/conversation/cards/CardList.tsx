import type { JSX } from 'solid-js';
import { For, Show, Switch, Match, type Component } from 'solid-js';
import styles from './cards.module.css';

/** Async list state shared by every list-style card (loading / error / items). */
export interface ListState<T> {
  loading?: boolean;
  error?: string | null;
  items: T[];
}

/**
 * Presentational list archetype: standardizes loading (skeleton), error (retry),
 * and empty states, then renders each item via the `children` row render-prop.
 */
export function CardList<T>(props: {
  state: ListState<T>;
  empty: string;
  onRetry?: () => void;
  children: (item: T, index: number) => JSX.Element;
}): JSX.Element {
  return (
    <Switch>
      <Match when={props.state.loading}>
        <div aria-busy="true">
          <div class={styles.skeleton} />
          <div class={styles.skeleton} />
          <div class={styles.skeleton} />
        </div>
      </Match>
      <Match when={props.state.error}>
        <p class={`${styles.state} ${styles.error}`} role="alert">
          {props.state.error}
          <Show when={props.onRetry}>
            <button type="button" class={styles.retry} onClick={() => props.onRetry!()}>Retry</button>
          </Show>
        </p>
      </Match>
      <Match when={props.state.items.length === 0}>
        <p class={styles.state} role="status">{props.empty}</p>
      </Match>
      <Match when={props.state.items.length > 0}>
        <div class={styles.list} role="list">
          <For each={props.state.items}>{(item, i) => props.children(item, i())}</For>
        </div>
      </Match>
    </Switch>
  );
}

/**
 * A single list row: a keyboard-accessible primary control (the whole row) plus
 * an optional separate trailing action button (avoids button-in-button). Pure.
 */
export const CardRow: Component<{
  onActivate?: () => void;
  activateLabel?: string;
  trailing?: JSX.Element;
  children: JSX.Element;
}> = (props) => (
  <div class={styles.row} role="listitem">
    <Show
      when={props.onActivate}
      fallback={<div class={styles.rowPrimary}>{props.children}</div>}
    >
      <button
        type="button"
        class={styles.rowPrimary}
        title={props.activateLabel}
        onClick={() => props.onActivate!()}
      >
        {props.children}
      </button>
    </Show>
    <Show when={props.trailing}>{props.trailing}</Show>
  </div>
);
