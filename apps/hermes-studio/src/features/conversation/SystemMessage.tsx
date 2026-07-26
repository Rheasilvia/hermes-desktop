import type { Component } from 'solid-js';
import styles from './SystemMessage.module.css';

interface SystemMessageProps {
  content: string;
}

export const SystemMessage: Component<SystemMessageProps> = (props) => {
  return (
    <div class={styles.wrapper}>
      <div class={styles.line} />
      <span class={styles.pill}>{props.content}</span>
      <div class={styles.line} />
    </div>
  );
};
