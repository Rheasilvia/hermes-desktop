import type { Component } from 'solid-js';
import { createSignal } from 'solid-js';
import { Icon } from './Icon.js';
import styles from './SearchInput.module.css';

export interface SearchInputProps {
  value?: string;
  placeholder?: string;
  disabled?: boolean;
  onChange?: (value: string) => void;
  onSearch?: (value: string) => void;
}

export const SearchInput: Component<SearchInputProps> = (props) => {
  const [internalValue, setInternalValue] = createSignal(props.value ?? '');

  const currentValue = () => props.value ?? internalValue();

  const handleInput = (e: InputEvent) => {
    const target = e.target as HTMLInputElement;
    const value = target.value;
    setInternalValue(value);
    props.onChange?.(value);
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      props.onSearch?.(currentValue());
    }
  };

  const handleClear = () => {
    setInternalValue('');
    props.onChange?.('');
  };

  const hasValue = () => currentValue().length > 0;

  return (
    <div class={styles.container}>
      <span class={styles.searchIcon}>
        <Icon name="search" size={16} strokeWidth={1.5} />
      </span>
      <input
        class={styles.input}
        type="search"
        value={currentValue()}
        placeholder={props.placeholder ?? 'Search...'}
        disabled={props.disabled}
        onInput={handleInput}
        onKeyDown={handleKeyDown}
      />
      {hasValue() && (
        <button
          class={styles.clearBtn}
          type="button"
          onClick={handleClear}
          aria-label="Clear search"
        >
          <Icon name="x" size={14} strokeWidth={2} />
        </button>
      )}
    </div>
  );
};
