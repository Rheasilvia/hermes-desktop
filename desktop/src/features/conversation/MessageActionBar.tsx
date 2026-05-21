import type { Component } from 'solid-js';
import { Icon } from '@/ui/atoms/Icon.js';
import styles from './MessageActionBar.module.css';

export type MessageActionType = 'copy' | 'retry' | 'edit' | 'delete' | 'branch' | 'like' | 'dislike' | 'more';

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
  { type: 'retry', icon: 'refresh-cw', label: 'Retry regenerates' },
  { type: 'like', icon: 'thumbs-up', label: 'Like' },
  { type: 'dislike', icon: 'thumbs-down', label: 'Dislike' },
  { type: 'more', icon: 'ellipsis', label: 'More' },
];

interface MessageActionBarProps {
  variant: 'user' | 'ai';
  onAction: (action: MessageActionType) => void;
}

export const MessageActionBar: Component<MessageActionBarProps> = (props) => {
  const actions = () => (props.variant === 'user' ? USER_ACTIONS : AI_ACTIONS);

  const handleClick = (action: MessageActionType) => {
    props.onAction(action);
  };

  return (
    <div class={`${styles.actionBar} ${props.variant === 'ai' ? styles.alignLeft : styles.alignRight}`}>
      {actions().map((action, index) => (
        <>
          {index > 0 && <div class={styles.divider} />}
          <button
            class={styles.actionButton}
            title={action.label}
            onClick={() => handleClick(action.type)}
          >
            <Icon name={action.icon as any} size={13} />
          </button>
        </>
      ))}
    </div>
  );
};
