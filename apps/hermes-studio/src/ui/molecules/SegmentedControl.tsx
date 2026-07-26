import type { Component } from 'solid-js';
import { For } from 'solid-js';
import { Icon } from '@/ui/atoms/Icon.js';
import type { IconName } from '@/ui/atoms/Icon.js';
import styles from './SegmentedControl.module.css';

export interface Segment<T extends string> {
  id: T;
  label: string;
  iconName?: IconName;
  ariaLabel?: string;
}

export interface SegmentedControlProps<T extends string> {
  segments: Segment<T>[];
  value: T;
  onChange: (id: T) => void;
  size?: 'sm' | 'md';
  ariaLabel?: string;
}

export function SegmentedControl<T extends string>(
  props: SegmentedControlProps<T>,
): ReturnType<Component> {
  const sizeClass = () => (props.size === 'sm' ? styles.sm : styles.md);

  return (
    <div
      class={`${styles.root} ${sizeClass()}`}
      role="tablist"
      aria-label={props.ariaLabel}
    >
      <For each={props.segments}>
        {(seg) => (
          <button
            type="button"
            role="tab"
            aria-selected={props.value === seg.id}
            aria-label={seg.ariaLabel}
            class={
              props.value === seg.id ? styles.segmentActive : styles.segment
            }
            onClick={() => props.onChange(seg.id)}
          >
            {seg.iconName && (
              <Icon
                name={seg.iconName}
                size={props.size === 'sm' ? 12 : 14}
                strokeWidth={1.75}
              />
            )}
            <span>{seg.label}</span>
          </button>
        )}
      </For>
    </div>
  );
}
