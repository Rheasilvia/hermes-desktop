import type { Component } from 'solid-js';
import { createSignal, createEffect, Show } from 'solid-js';
import { Icon } from '@/ui/atoms/Icon';
import styles from './WorkspacePicker.module.css';

interface WorkspacePickerProps {
  workspacePath: string | null | undefined;
  editable?: boolean;
  disabled?: boolean;
  onChange?: (path: string) => void;
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

  const isDisabled = () => props.disabled ?? false;
  const isEditable = () => (props.editable ?? false) && !isDisabled();

  const handleClick = async () => {
    if (isDisabled()) return;

    if (isEditable()) {
      try {
        const { open: openDialog } = await import('@tauri-apps/plugin-dialog');
        const selected = await openDialog({
          directory: true,
          title: 'Select Workspace',
        });
        if (selected && typeof selected === 'string') {
          props.onChange?.(selected);
        }
      } catch {
        // dialog plugin may not be available
      }
    } else {
      setOpen(!open());
    }
  };

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
        classList={{
          [styles.pill]: true,
          [styles.pillDisabled]: isDisabled(),
        }}
        ref={(el) => { pillRef = el; }}
        onClick={handleClick}
        type="button"
        disabled={isDisabled()}
        aria-label={isEditable() ? 'Change workspace folder' : 'Show full workspace path'}
      >
        <Icon name="folder-open" size={10} />
        <span>{workspaceName()}</span>
        <Show when={!isEditable() && open()}>
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
