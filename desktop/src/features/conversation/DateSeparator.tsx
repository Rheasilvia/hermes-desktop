import type { Component } from 'solid-js';
import styles from './DateSeparator.module.css';

interface DateSeparatorProps {
  label: string;
}

export const DateSeparator: Component<DateSeparatorProps> = (props) => {
  return (
    <div class={styles.wrapper}>
      <div class={styles.line} />
      <span class={styles.label}>{props.label}</span>
      <div class={styles.line} />
    </div>
  );
};
