import type { Component } from 'solid-js';
import { For, createSignal } from 'solid-js';
import { Input } from './Input.js';
import { Button } from './Button.js';
import { Pill } from './Pill.js';
import styles from './StringListField.module.css';

export interface StringListFieldProps {
  /** Current list of string values */
  values: string[];
  /** Called when a value is added */
  onAdd: (value: string) => void;
  /** Called when a value is removed */
  onRemove: (value: string) => void;
  /** Placeholder text for the input */
  placeholder?: string;
  /** Label for the add button */
  addLabel?: string;
  /** Disabled state */
  disabled?: boolean;
}

export const StringListField: Component<StringListFieldProps> = (props) => {
  const [inputValue, setInputValue] = createSignal('');
  const [announcement, setAnnouncement] = createSignal('');

  const handleAdd = () => {
    const val = inputValue().trim();
    if (!val || props.disabled) return;
    if (props.values.includes(val)) {
      setInputValue('');
      return;
    }
    props.onAdd(val);
    setAnnouncement(`"${val}" added`);
    setInputValue('');
    setTimeout(() => setAnnouncement(''), 2000);
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAdd();
    }
  };

  const handleRemove = (val: string) => {
    props.onRemove(val);
    setAnnouncement(`"${val}" removed`);
    setTimeout(() => setAnnouncement(''), 2000);
  };

  return (
    <div class={styles.container}>
      <div class={styles.addRow}>
        <Input
          type="text"
          value={inputValue()}
          placeholder={props.placeholder ?? 'Add item…'}
          disabled={props.disabled}
          onChange={(e) => setInputValue(e.currentTarget.value)}
          onKeyDown={handleKeyDown}
        />
        <Button
          size="sm"
          disabled={props.disabled || !inputValue().trim()}
          onClick={handleAdd}
        >
          {props.addLabel ?? 'Add'}
        </Button>
      </div>
      <div class={styles.list} role="list" aria-label="Items">
        <For each={props.values}>
          {(item) => (
            <Pill
              onRemove={props.disabled ? undefined : () => handleRemove(item)}
            >
              {item}
            </Pill>
          )}
        </For>
      </div>
      <span class={styles.announcement} aria-live="polite" aria-atomic="true">
        {announcement()}
      </span>
    </div>
  );
};
