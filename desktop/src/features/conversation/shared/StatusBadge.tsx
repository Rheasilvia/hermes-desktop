import type { Component } from 'solid-js';
import styles from './StatusBadge.module.css';

export type StatusBadgeTone = 'error' | 'idle' | 'info' | 'pending' | 'running' | 'success' | 'warning';

interface StatusBadgeProps {
  label: string;
  tone?: StatusBadgeTone;
}

export const StatusBadge: Component<StatusBadgeProps> = (props) => (
  <span class={`${styles.badge} ${styles[props.tone ?? 'info']}`}>
    <span class={styles.dot} aria-hidden="true" />
    <span>{props.label}</span>
  </span>
);
