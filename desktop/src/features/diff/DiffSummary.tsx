import type { Component } from 'solid-js';
import type { DiffSummary as DiffSummaryType } from '@/types/diff.js';
import styles from './DiffPanel.module.css';

interface DiffSummaryProps {
  summary: DiffSummaryType;
}

const formatDiffCount = (count: number) => {
  const absCount = Math.abs(count);
  if (absCount < 10_000) return String(absCount);

  const divisor = absCount >= 1_000_000 ? 1_000_000 : 1_000;
  const suffix = absCount >= 1_000_000 ? 'm' : 'k';
  const value = absCount / divisor;
  const precision = value < 100 ? 1 : 0;
  return `${value.toFixed(precision).replace(/\.0$/, '')}${suffix}`;
};

export const DiffSummary: Component<DiffSummaryProps> = (props) => {
  return (
    <span class={styles.diffSummary}>
      <span class={styles.diffSummaryInsertions} title={`+${props.summary.insertions}`}>
        +{formatDiffCount(props.summary.insertions)}
      </span>
      <span class={styles.diffSummaryDeletions} title={`−${props.summary.deletions}`}>
        −{formatDiffCount(props.summary.deletions)}
      </span>
    </span>
  );
};
