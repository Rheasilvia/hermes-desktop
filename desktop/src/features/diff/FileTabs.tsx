import type { Component } from 'solid-js';
import { For } from 'solid-js';
import type { DiffFile } from '@/types/diff.js';
import styles from './DiffPanel.module.css';

interface FileTabsProps {
  files: DiffFile[];
  activeIndex: number;
  onSelect: (index: number) => void;
}

const STATUS_DOT_CLASS: Record<string, string> = {
  added: styles.statusAdded,
  modified: styles.statusModified,
  deleted: styles.statusDeleted,
  renamed: styles.statusRenamed,
};

export const FileTabs: Component<FileTabsProps> = (props) => {
  return (
    <div class={styles.fileTabs}>
      <For each={props.files}>
        {(file, idx) => {
          const dotClass = STATUS_DOT_CLASS[file.status] ?? styles.statusModified;
          const fileName = file.path.split('/').pop() ?? file.path;
          return (
            <button
              type="button"
              class={`${styles.fileTab} ${idx() === props.activeIndex ? styles.fileTabActive : ''}`}
              onClick={() => props.onSelect(idx())}
            >
              <span class={`${styles.statusDot} ${dotClass}`} />
              <span class={styles.fileTabName}>{fileName}</span>
            </button>
          );
        }}
      </For>
    </div>
  );
};
