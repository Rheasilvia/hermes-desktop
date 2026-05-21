import type { Component } from 'solid-js';
import { Show, createSignal } from 'solid-js';
import { MessageActionBar, type MessageActionType } from './MessageActionBar.js';
import styles from './UserMessage.module.css';

interface UserMessageProps {
  content: string;
  timestamp?: number;
  onAction?: (action: MessageActionType) => void;
}

function formatTimestamp(ts: number): string {
  try {
    return new Date(ts * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

export const UserMessage: Component<UserMessageProps> = (props) => {
  const [showActions, setShowActions] = createSignal(false);

  return (
    <div
      class={styles.row}
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
    >
      <div class={styles.content}>
        <div class={styles.bubble}>{props.content}</div>
        <Show when={props.timestamp}>
          <span class={styles.timestamp}>{formatTimestamp(props.timestamp!)}</span>
        </Show>
        <Show when={showActions() && props.onAction}>
          <MessageActionBar variant="user" onAction={props.onAction!} />
        </Show>
      </div>
      <div class={styles.avatar}>U</div>
    </div>
  );
};
