import type { Component } from 'solid-js';
import type { DiffSummary as DiffSummaryType } from '@/types/diff.js';
import styles from './DiffPanel.module.css';

interface DiffSummaryProps {
  summary: DiffSummaryType;
}

export const DiffSummary: Component<DiffSummaryProps> = (props) => {
  return (
    <span class={styles.diffSummary}>
      <span class={styles.diffSummaryInsertions}>+{props.summary.insertions}</span>
      <span class={styles.diffSummaryDeletions}>−{props.summary.deletions}</span>
    </span>
  );
};
