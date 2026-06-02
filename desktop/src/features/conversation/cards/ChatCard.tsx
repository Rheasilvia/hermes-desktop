import type { Component, JSX } from 'solid-js';
import { Show } from 'solid-js';
import { Icon } from '@/ui/atoms/Icon.js';
import styles from './cards.module.css';

/**
 * Base shell for every command card. Owns all card chrome (surface, header,
 * close button) so per-command cards only supply a body. The dock provides the
 * `role="region"` wrapper and focus management; this is pure presentation.
 */
export const ChatCard: Component<{
  title: string;
  icon?: string;
  onClose: () => void;
  children: JSX.Element;
}> = (props) => (
  <div class={styles.card}>
    <div class={styles.header}>
      <Show when={props.icon}>
        <Icon name={props.icon as any} size={14} class={styles.headerIcon} />
      </Show>
      <span class={styles.title}>{props.title}</span>
      <button type="button" class={styles.close} aria-label="Dismiss card" onClick={props.onClose}>
        <Icon name="x" size={14} />
      </button>
    </div>
    <div class={styles.body}>{props.children}</div>
  </div>
);
