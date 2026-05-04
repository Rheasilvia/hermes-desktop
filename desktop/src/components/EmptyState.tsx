import type { Component, JSX } from 'solid-js';
import { Show } from 'solid-js';
import { Icon } from './Icon';
import type { IconName } from './Icon';
import styles from './EmptyState.module.css';

export interface EmptyStateProps {
  icon?: string;
  iconName?: IconName;
  title: string;
  description?: string;
  action?: JSX.Element;
}

export const EmptyState: Component<EmptyStateProps> = (props) => {
  return (
    <div class={styles.emptyState}>
      <Show when={props.iconName}>
        <div class={styles.icon}>
          <Icon name={props.iconName!} size={48} strokeWidth={1} />
        </div>
      </Show>
      <Show when={props.icon && !props.iconName}>
        <span class={styles.icon}>{props.icon}</span>
      </Show>
      <h3 class={styles.title}>{props.title}</h3>
      <Show when={props.description}>
        <p class={styles.description}>{props.description}</p>
      </Show>
      <Show when={props.action}>
        <div class={styles.action}>{props.action}</div>
      </Show>
    </div>
  );
};
