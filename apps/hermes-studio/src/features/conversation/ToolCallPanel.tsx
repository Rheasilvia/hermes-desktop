import type { Component } from 'solid-js';
import { createSignal, Show } from 'solid-js';
import type { ToolCallRow } from '@/types/index.js';
import { ToolCallTree } from './ToolCallTree.js';
import { ToolCallSummary } from './ToolCallSummary.js';
import { buildSummary } from './toolCallMappers.js';
import styles from './ToolCallPanel.module.css';

interface ToolCallPanelProps {
  rows: ToolCallRow[];
  isLive: boolean;
}

const ToolCallPanel: Component<ToolCallPanelProps> = (props) => {
  const [expanded, setExpanded] = createSignal(false);

  const showTree = () => props.isLive || expanded();
  const completedCount = () =>
    props.rows.filter((r) => r.status === 'complete').length;
  const summary = () => buildSummary(props.rows);

  return (
    <div class={styles.container}>
      <Show
        when={showTree()}
        fallback={
          <ToolCallSummary
            completedCount={completedCount()}
            summary={summary()}
            onExpand={() => setExpanded(true)}
          />
        }
      >
        <div class={styles.header}>
          <Show when={!props.isLive}>
            <button
              class={styles.collapseButton}
              onClick={() => setExpanded(false)}
            >
              Collapse ▴
            </button>
          </Show>
        </div>
        <ToolCallTree rows={props.rows} isActive={props.isLive} />
      </Show>
    </div>
  );
};

export { ToolCallPanel };
