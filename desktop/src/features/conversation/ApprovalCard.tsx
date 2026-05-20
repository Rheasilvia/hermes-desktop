import type { Component } from 'solid-js';
import styles from './ApprovalCard.module.css';

interface ApprovalCardProps {
  command: string;
  description: string;
  onAllow: () => void;
  onDeny: () => void;
}

export const ApprovalCard: Component<ApprovalCardProps> = (props) => {
  return (
    <div class={styles.card}>
      <div class={styles.main}>
        <span class={styles.dots}>
          <span class={`${styles.dot} ${styles.dot1}`} />
          <span class={`${styles.dot} ${styles.dot2}`} />
          <span class={`${styles.dot} ${styles.dot3}`} />
        </span>
        <span class={styles.title}>Waiting for approval</span>
        <span class={styles.command}>{props.command}</span>
      </div>
      <div class={styles.buttons}>
        <button class={styles.denyBtn} onClick={props.onDeny}>Deny</button>
        <button class={styles.allowBtn} onClick={props.onAllow}>Allow</button>
      </div>
    </div>
  );
};
