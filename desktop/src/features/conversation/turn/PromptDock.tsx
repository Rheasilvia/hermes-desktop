import type { Component, JSX } from 'solid-js';
import { For, Show, onMount } from 'solid-js';
import styles from './PromptDock.module.css';

export interface PromptDockItem {
  id: string;
  content: JSX.Element;
}

interface PromptDockProps {
  items: PromptDockItem[];
  label?: string;
  onDismiss?: () => void;
}

export const PromptDock: Component<PromptDockProps> = (props) => {
  let ref: HTMLDivElement | undefined;
  onMount(() => ref?.focus());

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && props.onDismiss) {
      e.stopPropagation();
      props.onDismiss();
    }
  };

  return (
    <Show when={props.items.length > 0}>
      <div
        ref={ref}
        class={styles.dock}
        role="region"
        aria-label={props.label ?? 'Chat action dock'}
        tabindex={-1}
        onKeyDown={onKeyDown}
      >
        <For each={props.items}>
          {(item) => <div class={styles.item}>{item.content}</div>}
        </For>
      </div>
    </Show>
  );
};
