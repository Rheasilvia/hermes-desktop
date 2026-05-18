import type { Component } from 'solid-js';
import { For } from 'solid-js';
import type { WebSearchResult } from '@/types/index.js';
import styles from './WebSearchCard.module.css';

interface WebSearchCardProps {
  data: WebSearchResult;
}

export const WebSearchCard: Component<WebSearchCardProps> = (props) => {
  return (
    <div class={styles.container}>
      <For each={props.data.results}>
        {(item) => (
          <div class={styles.item}>
            <span class={styles.itemTitle}>{item.title}</span>
            <span class={styles.url}>{item.url}</span>
            <span class={styles.snippet}>{item.snippet}</span>
          </div>
        )}
      </For>
    </div>
  );
};
