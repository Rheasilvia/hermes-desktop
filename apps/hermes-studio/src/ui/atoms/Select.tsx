import type { Component, JSX } from 'solid-js';
import { For, Show, createSignal } from 'solid-js';
import styles from './Select.module.css';

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps {
  options: SelectOption[];
  value?: string;
  placeholder?: string;
  disabled?: boolean;
  label?: string;
  onChange?: (value: string) => void;
}

export const Select: Component<SelectProps> = (props) => {
  const [isOpen, setIsOpen] = createSignal(false);

  const selectedOption = () =>
    props.options.find((o) => o.value === props.value);

  const handleSelect = (value: string) => {
    props.onChange?.(value);
    setIsOpen(false);
  };

  return (
    <div class={styles.container}>
      <Show when={props.label}>
        <label class={styles.label}>{props.label}</label>
      </Show>
      <button
        class={`${styles.trigger} ${isOpen() ? styles.open : ''}`}
        type="button"
        disabled={props.disabled}
        onClick={() => setIsOpen(!isOpen())}
      >
        <span class={styles.triggerText}>
          {selectedOption()?.label ?? props.placeholder ?? 'Select...'}
        </span>
        <span class={styles.arrow}>{isOpen() ? '▲' : '▼'}</span>
      </button>
      <Show when={isOpen()}>
        <div class={styles.dropdown}>
          <For each={props.options}>
            {(option) => (
              <button
                class={`${styles.option} ${option.value === props.value ? styles.selected : ''}`}
                type="button"
                onClick={() => handleSelect(option.value)}
              >
                {option.label}
              </button>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
};
