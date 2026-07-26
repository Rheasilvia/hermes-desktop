import type { Component } from 'solid-js';
import { For } from 'solid-js';
import type { DiffHunk as DiffHunkType } from '@/types/diff.js';
import { DiffLine } from './DiffLine.js';
import styles from './DiffPanel.module.css';

interface DiffHunkProps {
  hunk: DiffHunkType;
}

export const DiffHunk: Component<DiffHunkProps> = (props) => {
  return (
    <div class={styles.diffHunk}>
      <div class={styles.diffHunkHeader}>{props.hunk.header}</div>
      <For each={props.hunk.lines}>
        {(line, idx) => <DiffLine line={line} index={idx()} />}
      </For>
    </div>
  );
};
