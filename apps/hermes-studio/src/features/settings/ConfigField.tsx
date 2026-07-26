import type { Component } from 'solid-js';
import { Show } from 'solid-js';
import { Toggle } from '@/ui/atoms/Toggle.js';
import { Input } from '@/ui/atoms/Input.js';
import { Select } from '@/ui/atoms/Select.js';
import type { SelectOption } from '@/ui/atoms/Select.js';
import styles from './ConfigField.module.css';

export interface ConfigFieldProps {
  label: string;
  description?: string;
  type: 'text' | 'number' | 'select' | 'toggle' | 'slider';
  value: unknown;
  onChange: (value: unknown) => void;
  options?: SelectOption[];
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
  error?: string;
}

export const ConfigField: Component<ConfigFieldProps> = (props) => {
  const handleToggle = (checked: boolean) => {
    props.onChange(checked);
  };

  const handleTextChange = (e: Event) => {
    const target = e.currentTarget as HTMLInputElement;
    props.onChange(target.value);
  };

  const handleNumberChange = (e: Event) => {
    const target = e.currentTarget as HTMLInputElement;
    const num = parseFloat(target.value);
    props.onChange(isNaN(num) ? undefined : num);
  };

  const handleSelectChange = (value: string) => {
    props.onChange(value);
  };

  const handleSliderInput = (e: InputEvent) => {
    const target = e.currentTarget as HTMLInputElement;
    const num = parseFloat(target.value);
    props.onChange(isNaN(num) ? undefined : num);
  };

  return (
    <div class={styles.field}>
      <div class={styles.header}>
        <label class={styles.label}>{props.label}</label>
        <Show when={props.description}>
          <p class={styles.description}>{props.description}</p>
        </Show>
      </div>
      <div class={styles.control}>
        <Show when={props.type === 'toggle'}>
          <Toggle
            checked={props.value as boolean}
            onChange={handleToggle}
          />
        </Show>
        <Show when={props.type === 'text'}>
          <Input
            type="text"
            value={(props.value as string) ?? ''}
            placeholder={props.placeholder}
            error={props.error}
            onChange={handleTextChange}
          />
        </Show>
        <Show when={props.type === 'number'}>
          <Input
            type="number"
            value={props.value != null ? String(props.value) : ''}
            placeholder={props.placeholder}
            error={props.error}
            onChange={handleNumberChange}
          />
        </Show>
        <Show when={props.type === 'select'}>
          <Select
            options={props.options ?? []}
            value={(props.value as string) ?? ''}
            placeholder={props.placeholder}
            onChange={handleSelectChange}
          />
        </Show>
        <Show when={props.type === 'slider'}>
          <div class={styles.sliderWrapper}>
            <input
              type="range"
              class={styles.slider}
              min={props.min ?? 0}
              max={props.max ?? 100}
              step={props.step ?? 1}
              value={(props.value as number) ?? 0}
              onInput={handleSliderInput}
            />
            <span class={styles.sliderValue}>
              {props.value != null ? String(props.value) : ''}
            </span>
          </div>
        </Show>
      </div>
    </div>
  );
};
