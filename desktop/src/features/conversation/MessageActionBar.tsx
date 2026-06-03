import type { Component } from 'solid-js';
import { Icon } from '@/ui/atoms/Icon.js';
import styles from './MessageActionBar.module.css';

export type MessageActionType = 'copy' | 'retry' | 'undo' | 'edit' | 'delete' | 'branch' | 'like' | 'dislike' | 'more';

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
  { type: 'undo', icon: 'corner-up-left', label: 'Undo this turn' },
  { type: 'like', icon: 'thumbs-up', label: 'Like' },
  { type: 'dislike', icon: 'thumbs-down', label: 'Dislike' },
  { type: 'more', icon: 'ellipsis', label: 'More' },
];

interface MessageActionBarProps {
  variant: 'user' | 'ai';
  onAction: (action: MessageActionType) => void;
  /** When true, all action buttons are disabled (e.g. while streaming). */
  disabled?: boolean;
  /** When false, retry is hidden — only meaningful on the last assistant message. */
  isLast?: boolean;
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
    </div>
  );
};
