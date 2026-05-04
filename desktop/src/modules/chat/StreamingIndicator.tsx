import type { Component } from 'solid-js';
import styles from './StreamingIndicator.module.css';

interface StreamingIndicatorProps {
  label?: string;
}

export const StreamingIndicator: Component<StreamingIndicatorProps> = (props) => {
  const label = () => props.label ?? 'Thinking';

  return (
    <div class={styles.wrapper}>
      <span class={styles.dots}>
        <span class={styles.dot} />
        <span class={styles.dot} />
        <span class={styles.dot} />
      </span>
      <span>{label()}</span>
    </div>
  );
};
