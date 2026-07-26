import type { Component } from 'solid-js';
import { For, createSignal } from 'solid-js';
import type { MemoryContextItem } from '@/types/index.js';
import styles from './MemoryContextCard.module.css';

interface MemoryContextCardProps {
  items: MemoryContextItem[];
  onEdit: () => void;
}

export const MemoryContextCard: Component<MemoryContextCardProps> = (props) => {
  const [expanded, setExpanded] = createSignal(false);

  return (
    <div class={styles.banner}>
      <button class={styles.header} onClick={() => setExpanded((v) => !v)}>
        <span class={styles.brainIcon}>🧠</span>
        <span class={styles.label}>
          Memory in use&nbsp;&nbsp;({props.items.length} items)
        </span>
        <span class={styles.chevron} classList={{ [styles.chevronOpen!]: expanded() }}>▾</span>
      </button>

      <For each={expanded() ? props.items : []}>
        {(item) => (
          <div class={styles.item}>
            <span class={styles.itemCategory}>{item.category}</span>
            <span class={styles.itemContent}>{item.content}</span>
          </div>
        )}
      </For>

      <For each={expanded() ? [null] : []}>
        {() => (
          <button class={styles.editBtn} onClick={props.onEdit}>
            Edit memory
          </button>
        )}
      </For>
    </div>
  );
};
