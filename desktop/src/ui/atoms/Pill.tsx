import type { Component, JSX } from 'solid-js';
import { Icon } from './Icon.js';
import styles from './Pill.module.css';

export interface PillProps {
  children: JSX.Element;
  variant?: 'default' | 'primary' | 'secondary' | 'outline';
  onRemove?: () => void;
}

export const Pill: Component<PillProps> = (props) => {
  const variant = () => props.variant ?? 'default';

  return (
    <span class={`${styles.pill} ${styles[variant()]}`}>
      {props.children}
      {props.onRemove && (
        <button
          class={styles.removeBtn}
          onClick={props.onRemove}
          type="button"
          aria-label="Remove"
        >
          <Icon name="x" size={12} strokeWidth={2} />
        </button>
      )}
    </span>
  );
};
