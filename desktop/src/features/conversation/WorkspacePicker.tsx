import type { Component } from 'solid-js';
import { createSignal, createEffect, createMemo, Show } from 'solid-js';
import { Icon } from '@/ui/atoms/Icon';
import styles from './WorkspacePicker.module.css';

interface WorkspacePickerProps {
  workspacePath: string | null | undefined;
  editable?: boolean;
  disabled?: boolean;
  onChange?: (path: string) => void;
}

function isTauri() {
  return typeof window !== 'undefined' && '__TAURI__' in window;
}

export const WorkspacePicker: Component<WorkspacePickerProps> = (props) => {
  const [open, setOpen] = createSignal(false);
  const [isEditing, setIsEditing] = createSignal(false);
  const [editValue, setEditValue] = createSignal('');
  let pillRef: HTMLButtonElement | undefined;
  let inputRef: HTMLInputElement | undefined;

  const workspaceName = createMemo(() => {
    const path = props.workspacePath;
    if (!path) return null;
    const normalized = path.replace(/\\/g, '/');
    return normalized.split('/').pop() || path;
  });

  const isDisabled = () => props.disabled ?? false;
  const isEditable = () => (props.editable ?? false) && !isDisabled();

  const startEditing = () => {
    setEditValue(props.workspacePath || '');
    setIsEditing(true);
    setTimeout(() => inputRef?.focus(), 0);
  };

  const confirmEdit = () => {
    const v = editValue().trim();
    if (v) {
      props.onChange?.(v);
    }
    setIsEditing(false);
  };

  const cancelEdit = () => {
    setIsEditing(false);
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      confirmEdit();
    } else if (e.key === 'Escape') {
      cancelEdit();
    }
  };

  const handleClick = async () => {
    if (isDisabled()) return;

    if (isEditable()) {
      if (isTauri()) {
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
        startEditing();
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
    <Show when={workspaceName() || isEditing()}>
      <Show when={isEditing()}>
        <div class={styles.pill} style={{ padding: '2px 4px', gap: '2px' }}>
          <Icon name="folder-open" size={10} />
          <input
            ref={(el) => { inputRef = el; }}
            type="text"
            value={editValue()}
            onInput={(e) => setEditValue(e.currentTarget.value)}
            onKeyDown={handleKeyDown}
            onBlur={cancelEdit}
            style={{
              border: 'none',
              background: 'transparent',
              outline: 'none',
              font: 'inherit',
              color: 'inherit',
              width: '180px',
              'font-size': '11px',
            }}
          />
          <button
            type="button"
            onClick={confirmEdit}
            style={{
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
              padding: '0 2px',
              'font-size': '11px',
              color: '#5e5d59',
            }}
          >
            <Icon name="check" size={10} />
          </button>
          <button
            type="button"
            onClick={cancelEdit}
            style={{
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
              padding: '0 2px',
              'font-size': '11px',
              color: '#5e5d59',
            }}
          >
            <Icon name="x" size={10} />
          </button>
        </div>
      </Show>

      <Show when={!isEditing()}>
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
    </Show>
  );
};
