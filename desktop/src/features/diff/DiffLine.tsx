import type { Component } from 'solid-js';
import type { DiffLine as DiffLineType } from '@/types/diff.js';
import styles from './DiffPanel.module.css';

interface DiffLineProps {
  line: DiffLineType;
  index: number;
}

const LINE_KIND_CLASS: Record<string, string> = {
  context: styles.diffLineContext,
  addition: styles.diffLineAddition,
  deletion: styles.diffLineDeletion,
};

const LINE_PREFIX: Record<string, string> = {
  context: ' ',
  addition: '+',
  deletion: '−',
};

export const DiffLine: Component<DiffLineProps> = (props) => {
  const kindClass = LINE_KIND_CLASS[props.line.kind] ?? styles.diffLineContext;
  const prefix = LINE_PREFIX[props.line.kind] ?? ' ';

  return (
    <div class={`${styles.diffLine} ${kindClass}`}>
      <span class={styles.diffLineNumber}>
        {props.line.old_lineno != null ? props.line.old_lineno : ''}
      </span>
      <span class={styles.diffLineNumber}>
        {props.line.new_lineno != null ? props.line.new_lineno : ''}
      </span>
      <span class={styles.diffLinePrefix}>{prefix}</span>
      <span class={styles.diffLineContent}>{props.line.content}</span>
    </div>
  );
};
