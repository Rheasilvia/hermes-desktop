import type { Component } from 'solid-js';
import { Show } from 'solid-js';
import styles from './UserMessage.module.css';

interface UserMessageProps {
  content: string;
  timestamp?: number;
}

function formatTimestamp(ts: number): string {
  try {
    return new Date(ts * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

export const UserMessage: Component<UserMessageProps> = (props) => {
  return (
    <div class={styles.row}>
      <div class={styles.content}>
        <div class={styles.bubble}>{props.content}</div>
        <Show when={props.timestamp}>
          <span class={styles.timestamp}>{formatTimestamp(props.timestamp!)}</span>
        </Show>
      </div>
      <div class={styles.avatar}>U</div>
    </div>
  );
};
