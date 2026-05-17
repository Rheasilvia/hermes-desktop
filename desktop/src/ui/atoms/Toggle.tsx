import type { Component } from 'solid-js';
import { createSignal, createEffect } from 'solid-js';
import styles from './Toggle.module.css';

export interface ToggleProps {
  checked?: boolean;
  disabled?: boolean;
  label?: string;
  onChange?: (checked: boolean) => void;
}

export const Toggle: Component<ToggleProps> = (props) => {
  const [isChecked, setIsChecked] = createSignal(props.checked ?? false);

  createEffect(() => {
    setIsChecked(props.checked ?? false);
  });

  const handleToggle = () => {
    if (props.disabled) return;
    const next = !isChecked();
    setIsChecked(next);
    props.onChange?.(next);
  };

  return (
    <label class={`${styles.wrapper} ${props.disabled ? styles.disabled : ''}`}>
      <button
        class={`${styles.track} ${isChecked() ? styles.checked : ''}`}
        type="button"
        role="switch"
        aria-checked={isChecked()}
        disabled={props.disabled}
        onClick={handleToggle}
      >
        <span class={styles.thumb} />
      </button>
      {props.label && (
        <span class={styles.label}>{props.label}</span>
      )}
    </label>
  );
};
