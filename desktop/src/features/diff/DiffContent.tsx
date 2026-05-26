import type { Component } from 'solid-js';
import { For, Show } from 'solid-js';
import type { DiffFile } from '@/types/diff.js';
import { DiffHunk } from './DiffHunk.js';
import styles from './DiffPanel.module.css';

interface DiffContentProps {
  files: DiffFile[];
  activeIndex?: number;
  onSelectFile?: (index: number) => void;
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
        {(file, index) => (
          <div class={styles.diffFileSection}>
            <button
              type="button"
              class={styles.diffFileHeader}
              classList={{ [styles.diffFileHeaderActive]: props.activeIndex === index() }}
              onClick={() => props.onSelectFile?.(index())}
            >
              <span class={styles.diffFileName}>{file.path}</span>
              <span class={`${styles.diffFileStatus} ${styles[`fileStatus${STATUS_LABEL[file.status] ?? 'Modified'}`]}`}>
                {STATUS_LABEL[file.status] ?? 'Modified'}
              </span>
            </button>
            <Show when={props.activeIndex == null || props.activeIndex === index()}>
              <For each={file.hunks}>
                {(hunk) => <DiffHunk hunk={hunk} />}
              </For>
            </Show>
          </div>
        )}
      </For>
    </div>
  );
};
