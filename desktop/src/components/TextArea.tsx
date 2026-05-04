import type { Component, JSX } from 'solid-js';
import { Show } from 'solid-js';
import styles from './TextArea.module.css';

export interface TextAreaProps {
  value?: string;
  placeholder?: string;
  label?: string;
  disabled?: boolean;
  error?: string;
  rows?: number;
  resize?: 'none' | 'vertical' | 'horizontal' | 'both';
  onInput?: JSX.EventHandler<HTMLTextAreaElement, InputEvent>;
  onChange?: JSX.EventHandler<HTMLTextAreaElement, Event>;
}

export const TextArea: Component<TextAreaProps> = (props) => {
  return (
    <div class={styles.container}>
      <Show when={props.label}>
        <label class={styles.label}>{props.label}</label>
      </Show>
      <textarea
        class={`${styles.textarea} ${props.error ? styles.hasError : ''}`}
        value={props.value}
        placeholder={props.placeholder}
        disabled={props.disabled}
        rows={props.rows ?? 4}
        style={{ resize: props.resize ?? 'vertical' }}
        onInput={props.onInput}
        onChange={props.onChange}
      />
      <Show when={props.error}>
        <span class={styles.error}>{props.error}</span>
      </Show>
    </div>
  );
};
