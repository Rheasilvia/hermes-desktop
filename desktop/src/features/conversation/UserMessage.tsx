import type { Component } from 'solid-js';
import { Show, createSignal } from 'solid-js';
import { Icon } from '@/ui/atoms/Icon.js';
import { MessageActionBar, type MessageActionType } from './MessageActionBar.js';
import styles from './UserMessage.module.css';

interface UserMessageProps {
  content: string;
  /** When set, this message was a slash command — render the command label
   *  above the typed content instead of the raw (expanded) text. */
  slashCommand?: { command: string; args: string };
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
        <div class={styles.bubble} classList={{ [styles.commandBubble]: !!props.slashCommand }}>
          <Show when={props.slashCommand} fallback={props.content}>
            <span class={styles.commandLabel}>
              <Icon name="zap" size={12} />
              <span class={styles.commandName}>/{props.slashCommand!.command}</span>
            </span>
            <Show when={props.slashCommand!.args}>
              <span class={styles.commandArgs}>{props.slashCommand!.args}</span>
            </Show>
          </Show>
        </div>
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
