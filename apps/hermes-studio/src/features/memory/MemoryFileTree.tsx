/**
 * Memory file list — a flat group of leaves with optional header.
 *
 * Used inside the Manager left rail. Pure presentational: data + selection
 * callback in, JSX out. State lives in `memoryStore`; consumers wire the
 * click handler to `setSelection`.
 */
import { Component, For, Show } from 'solid-js';
import type { MemoryFile, MemoryScope, WellKnownMemoryName } from '@/types/memory.js';
import { Icon } from '@/ui/atoms/Icon.js';
import styles from './MemoryFileTree.module.css';

export interface MemoryFileTreeProps {
  files: MemoryFile[];
  selected?: { scope: MemoryScope; name: WellKnownMemoryName; workspace?: string } | null;
  onSelect: (file: MemoryFile) => void;
  loading?: boolean;
  class?: string;
  density?: 'comfortable' | 'compact';
  /** Drop entries with `exists === false` from the rendered list. */
  hideMissing?: boolean;
}

function isSelected(
  file: MemoryFile,
  selected: MemoryFileTreeProps['selected'],
): boolean {
  if (!selected) return false;
  return (
    file.scope === selected.scope &&
    file.well_known_name === selected.name &&
    (file.workspace_path ?? undefined) === selected.workspace
  );
}

export const MemoryFileTree: Component<MemoryFileTreeProps> = (props) => {
  const visible = () =>
    props.hideMissing ? props.files.filter((f) => f.exists) : props.files;

  return (
    <ul
      class={`${styles.tree} ${props.density === 'compact' ? styles.compact : ''} ${
        props.class ?? ''
      } ${props.loading ? styles.loading : ''}`.trim()}
    >
      <For each={visible()}>
        {(file) => {
          const active = () => isSelected(file, props.selected);
          return (
            <li>
              <button
                type="button"
                class={`${styles.row} ${active() ? styles.active : ''}`}
                onClick={() => props.onSelect(file)}
                title={file.abs_path}
              >
                <Icon
                  name="file-text"
                  size={props.density === 'compact' ? 12 : 14}
                  strokeWidth={1.5}
                  class={styles.icon}
                />
                <span class={styles.name}>{file.well_known_name}</span>
                <Show when={!props.hideMissing && !file.exists}>
                  <span class={styles.empty}>empty</span>
                </Show>
              </button>
            </li>
          );
        }}
      </For>
    </ul>
  );
};

