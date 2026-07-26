import type { Component } from 'solid-js';
import styles from './LoadingSpinner.module.css';

export interface LoadingSpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  label?: string;
}

export const LoadingSpinner: Component<LoadingSpinnerProps> = (props) => {
  const size = () => props.size ?? 'md';

  return (
    <div class={styles.spinnerWrapper}>
      <div class={`${styles.spinner} ${styles[size()]}`}>
        <div class={styles.ring} />
      </div>
      {props.label && (
        <span class={styles.label}>{props.label}</span>
      )}
    </div>
  );
};
