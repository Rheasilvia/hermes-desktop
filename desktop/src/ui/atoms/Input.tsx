import type { Component, JSX } from 'solid-js';
import { Show } from 'solid-js';
import styles from './Input.module.css';

export interface InputProps {
  value?: string;
  placeholder?: string;
  label?: string;
  type?: 'text' | 'password' | 'email' | 'number' | 'search';
  disabled?: boolean;
  error?: string;
  icon?: JSX.Element;
  onInput?: JSX.EventHandler<HTMLInputElement, InputEvent>;
  onChange?: JSX.EventHandler<HTMLInputElement, Event>;
  onKeyDown?: JSX.EventHandler<HTMLInputElement, KeyboardEvent>;
}

export const Input: Component<InputProps> = (props) => {
  return (
    <div class={styles.container}>
      <Show when={props.label}>
        <label class={styles.label}>{props.label}</label>
      </Show>
      <div class={styles.inputWrapper}>
        <Show when={props.icon}>
          <span class={styles.icon}>{props.icon}</span>
        </Show>
        <input
          class={`${styles.input} ${props.error ? styles.hasError : ''} ${props.icon ? styles.withIcon : ''}`}
          type={props.type ?? 'text'}
          value={props.value}
          placeholder={props.placeholder}
          disabled={props.disabled}
          onInput={props.onInput}
          onChange={props.onChange}
          onKeyDown={props.onKeyDown}
        />
      </div>
      <Show when={props.error}>
        <span class={styles.error}>{props.error}</span>
      </Show>
    </div>
  );
};
