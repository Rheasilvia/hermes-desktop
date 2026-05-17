import type { Component } from 'solid-js';
import { Show } from 'solid-js';
import { Icon } from '@/ui/atoms/Icon.js';
import styles from './ErrorBanner.module.css';

interface ErrorBannerProps {
  message: string;
  onRetry?: () => void;
  onDismiss?: () => void;
}

export const ErrorBanner: Component<ErrorBannerProps> = (props) => {
  return (
    <div class={styles.wrapper}>
      <Icon name="alert-circle" size={16} class={styles.icon} />
      <span class={styles.message}>{props.message}</span>
      <Show when={props.onRetry}>
        <button class={styles.actionBtn} type="button" onClick={props.onRetry}>
          <Icon name="refresh-cw" size={12} />
          <span>Retry</span>
        </button>
      </Show>
      <Show when={props.onDismiss}>
        <button class={styles.dismissBtn} type="button" onClick={props.onDismiss}>
          <Icon name="x" size={14} />
        </button>
      </Show>
    </div>
  );
};
