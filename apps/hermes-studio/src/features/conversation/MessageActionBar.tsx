import type { Component } from 'solid-js';
import { Show } from 'solid-js';
import { Icon } from '@/ui/atoms/Icon.js';
import { configStore } from '@/stores/config.js';
import { playSpeechText, isVoicePlaybackActive } from '@/lib/voice/voice-playback.js';
import { isTtsAvailable } from '@/lib/voice/voice-config.js';
import styles from './MessageActionBar.module.css';

export type MessageActionType = 'copy' | 'retry' | 'undo' | 'edit' | 'delete' | 'branch';

interface MessageAction {
  type: MessageActionType;
  icon: string;
  label: string;
}

const USER_ACTIONS: MessageAction[] = [
  { type: 'edit', icon: 'pencil', label: 'Edit' },
  { type: 'copy', icon: 'copy', label: 'Copy' },
];

const AI_ACTIONS: MessageAction[] = [
  { type: 'copy', icon: 'copy', label: 'Copy' },
  { type: 'retry', icon: 'refresh-cw', label: 'Retry' },
  { type: 'undo', icon: 'corner-down-left', label: 'Undo this turn' },
];

interface MessageActionBarProps {
  variant: 'user' | 'ai';
  onAction: (action: MessageActionType) => void;
  /** When true, all action buttons are disabled (e.g. while streaming). */
  disabled?: boolean;
  /** When false, retry is hidden — only meaningful on the last assistant message. */
  isLast?: boolean;
  /** Plain text content of the assistant message — used for read-aloud. */
  plainText?: string;
  /** Message id — used as playback identity for read-aloud. */
  messageId?: string;
}

export const MessageActionBar: Component<MessageActionBarProps> = (props) => {
  const actions = () => {
    const base = props.variant === 'user' ? USER_ACTIONS : AI_ACTIONS;
    if (props.variant === 'ai' && !props.isLast) {
      return base.filter((a) => a.type !== 'retry' && a.type !== 'undo');
    }
    return base;
  };

  const handleClick = (action: MessageActionType) => {
    if (!props.disabled) props.onAction(action);
  };

  const ttsEnabled = () => isTtsAvailable(configStore.config);

  const handleReadAloud = () => {
    if (!props.plainText || props.disabled) return;
    void playSpeechText(props.plainText, { source: 'read-aloud', messageId: props.messageId ?? null });
  };

  return (
    <div class={`${styles.actionBar} ${props.variant === 'ai' ? styles.alignLeft : styles.alignRight}`}>
      {actions().map((action, index) => (
        <>
          {index > 0 && <div class={styles.divider} />}
          <button
            class={styles.actionButton}
            classList={{ [styles.actionButtonDisabled]: !!props.disabled }}
            title={action.label}
            disabled={!!props.disabled}
            onClick={() => handleClick(action.type)}
          >
            <Icon name={action.icon as any} size={13} />
          </button>
        </>
      ))}
      <Show when={props.variant === 'ai' && ttsEnabled() && props.plainText}>
        <div class={styles.divider} />
        <button
          class={styles.actionButton}
          classList={{ [styles.actionButtonDisabled]: !!props.disabled }}
          title="Read aloud"
          disabled={!!props.disabled}
          onClick={handleReadAloud}
        >
          <Icon name="volume-2" size={13} />
        </button>
      </Show>
    </div>
  );
};
