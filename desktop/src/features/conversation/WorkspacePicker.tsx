import type { Component } from 'solid-js';
import { createSignal, createEffect, Show } from 'solid-js';
import { Icon } from '@/ui/atoms/Icon';
import styles from './WorkspacePicker.module.css';

interface WorkspacePickerProps {
  workspacePath: string | null | undefined;
}

export const WorkspacePicker: Component<WorkspacePickerProps> = (props) => {
  const [open, setOpen] = createSignal(false);
  let pillRef: HTMLButtonElement | undefined;

  const workspaceName = () => {
    const path = props.workspacePath;
    if (!path) return null;
    const normalized = path.replace(/\\/g, '/');
    return normalized.split('/').pop() || path;
  };

  const toggle = () => setOpen(!open());

  const handleClickOutside = (e: MouseEvent) => {
    if (!pillRef || !pillRef.contains(e.target as Node)) {
      setOpen(false);
    }
  };

  createEffect(() => {
    if (open()) {
      document.addEventListener('click', handleClickOutside, true);
    } else {
      document.removeEventListener('click', handleClickOutside, true);
    }
  });

  return (
    <Show when={workspaceName()}>
      <button
        class={styles.pill}
        ref={(el) => { pillRef = el; }}
        onClick={toggle}
        type="button"
        aria-label="Show full workspace path"
      >
        <Icon name="folder-open" size={10} />
        <span>{workspaceName()}</span>
        <Show when={open()}>
          <div class={styles.popover}>
            <div class={styles.popoverContent}>
              <Icon name="folder-open" size={12} />
              <span>{props.workspacePath}</span>
            </div>
          </div>
        </Show>
      </button>
    </Show>
  );
};
