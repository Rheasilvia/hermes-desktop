import type { Component } from 'solid-js';
import { For } from 'solid-js';
import type { DiffFile } from '@/types/diff.js';
import { DiffHunk } from './DiffHunk.js';
import styles from './DiffPanel.module.css';

interface DiffContentProps {
  files: DiffFile[];
}

const STATUS_LABEL: Record<string, string> = {
  added: 'Added',
  modified: 'Modified',
  deleted: 'Deleted',
  renamed: 'Renamed',
};

export const DiffContent: Component<DiffContentProps> = (props) => {
  return (
    <div class={styles.diffContent}>
      <For each={props.files}>
        {(file) => (
          <div class={styles.diffFileSection}>
            {/* File-level header as section separator */}
            <div class={styles.diffFileHeader}>
              <span class={styles.diffFileName}>{file.path}</span>
              <span class={`${styles.diffFileStatus} ${styles[`fileStatus${STATUS_LABEL[file.status] ?? 'Modified'}`]}`}>
                {STATUS_LABEL[file.status] ?? 'Modified'}
              </span>
            </div>
            <For each={file.hunks}>
              {(hunk) => <DiffHunk hunk={hunk} />}
            </For>
          </div>
        )}
      </For>
    </div>
  );
};
