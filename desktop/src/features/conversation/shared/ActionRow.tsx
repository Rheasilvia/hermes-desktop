import type { Component, JSX } from 'solid-js';
import { Show } from 'solid-js';
import { Icon, type IconName } from '@/ui/atoms/Icon.js';
import styles from './ActionRow.module.css';

interface ActionRowProps {
  icon?: IconName;
  title: string;
  meta?: string;
  preview?: string;
  trailing?: JSX.Element;
}

export const ActionRow: Component<ActionRowProps> = (props) => (
  <div class={styles.row}>
    <Show when={props.icon}>
      <span class={styles.icon} aria-hidden="true">
        <Icon name={props.icon!} size={14} />
      </span>
    </Show>
    <div class={styles.body}>
      <div class={styles.top}>
        <span class={styles.title} title={props.title}>{props.title}</span>
        <Show when={props.meta}>
          <span class={styles.meta} title={props.meta}>{props.meta}</span>
        </Show>
      </div>
      <Show when={props.preview}>
        <p class={styles.preview} title={props.preview}>{props.preview}</p>
      </Show>
    </div>
    <Show when={props.trailing}>
      <div class={styles.trailing}>{props.trailing}</div>
    </Show>
  </div>
);
