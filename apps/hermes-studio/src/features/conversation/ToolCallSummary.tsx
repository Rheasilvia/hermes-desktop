import type { Component } from 'solid-js';
import { Show } from 'solid-js';
import { Icon } from '@/ui/atoms/Icon';
import styles from './ToolCallSummary.module.css';

interface ToolCallSummaryProps {
  completedCount: number;
  summary: string;
  onExpand: () => void;
}

const ToolCallSummary: Component<ToolCallSummaryProps> = (props) => {
  return (
    <div class={styles.container}>
      <Icon name="check-circle" size={14} class={styles.checkIcon} />
      <span class={styles.count}>{props.completedCount} tools completed</span>
      <Show when={props.summary}>
        <span class={styles.summary}>{props.summary}</span>
      </Show>
      <button class={styles.detailsButton} onClick={props.onExpand}>
        Details
      </button>
    </div>
  );
};

export { ToolCallSummary };
