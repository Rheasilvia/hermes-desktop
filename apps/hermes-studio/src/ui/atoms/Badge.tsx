import type { Component } from 'solid-js';
import styles from './Badge.module.css';

export type BadgeStatus = 'active' | 'inactive' | 'pending' | 'error';

export interface BadgeProps {
  status: BadgeStatus;
  label?: string;
}

export const Badge: Component<BadgeProps> = (props) => {
  const label = () => props.label ?? props.status;

  return (
    <span class={`${styles.badge} ${styles[props.status]}`}>
      <span class={styles.dot} />
      <span>{label()}</span>
    </span>
  );
};
