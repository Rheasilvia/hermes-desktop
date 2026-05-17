import type { Component } from 'solid-js';
import { Icon } from '@/ui/atoms/Icon.js';
import styles from './WorkspacePicker.module.css';

interface WorkspacePickerProps {
  onSelect: () => void;
}

export const WorkspacePicker: Component<WorkspacePickerProps> = (props) => {
  return (
    <>
      <div class={styles.title}>Select a workspace to begin</div>
      <div class={styles.description}>
        Hermes needs a working directory to run commands and track file changes.
      </div>
      <button type="button" class={styles.pickerBtn} onClick={props.onSelect}>
        <Icon name="folder-open" size={14} />
        <span>Choose folder...</span>
      </button>
    </>
  );
};
