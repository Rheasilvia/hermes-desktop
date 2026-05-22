import type { Component } from 'solid-js';
import { Show } from 'solid-js';
import { Icon } from '@/ui/atoms/Icon.js';
import styles from './JumpToBottom.module.css';

interface JumpToBottomProps {
  unreadCount: number;
  visible: boolean;
  onClick: () => void;
}

export const JumpToBottom: Component<JumpToBottomProps> = (props) => {
  const badgeText = () => {
    if (props.unreadCount <= 0) return '';
    if (props.unreadCount > 99) return '99+ new';
    return `${props.unreadCount} new`;
  };

  return (
    <Show when={props.visible}>
      <div class={styles.wrapper}>
        <Show when={props.unreadCount > 0}>
          <span class={styles.badge}>{badgeText()}</span>
        </Show>
        <button
          class={styles.button}
          onClick={props.onClick}
          type="button"
          aria-label="Jump to bottom"
        >
          <Icon name="arrow-down" size={14} />
        </button>
      </div>
    </Show>
  );
};
