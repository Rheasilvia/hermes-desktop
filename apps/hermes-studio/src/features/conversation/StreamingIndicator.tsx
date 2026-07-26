import type { Component } from 'solid-js';
import { Show } from 'solid-js';
import { Avatar } from '@/ui/atoms/Avatar.js';
import styles from './StreamingIndicator.module.css';

interface StreamingIndicatorProps {
  label?: string;
  showAvatar?: boolean;
}

export const StreamingIndicator: Component<StreamingIndicatorProps> = (props) => {
  const label = () => props.label ?? '';
  const showAvatar = () => props.showAvatar ?? true;

  return (
    <div class={styles.wrapper}>
      <Show when={showAvatar()}>
        <Avatar initials="H" size={28} />
      </Show>
      <span class={styles.dots}>
        <span class={`${styles.dot} ${styles.dot1}`} />
        <span class={`${styles.dot} ${styles.dot2}`} />
        <span class={`${styles.dot} ${styles.dot3}`} />
      </span>
      <Show when={label()}>
        <span class={styles.label}>{label()}</span>
      </Show>
    </div>
  );
};
