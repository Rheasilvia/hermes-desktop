import type { Component } from 'solid-js';
import { Show, Index } from 'solid-js';
import { Icon } from '@/ui/atoms/Icon';
import type { ToolCallRow } from '@/types/index.js';
import styles from './ToolCallTree.module.css';

interface ToolCallTreeProps {
  rows: ToolCallRow[];
  isActive?: boolean;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

const ToolCallTree: Component<ToolCallTreeProps> = (props) => {
  return (
    <div class={styles.container}>
      <div class={styles.header}>TOOL CALLS</div>
      <Index each={props.rows}>
        {(row) => {
          const isActive = () =>
            row().status === 'generating' || row().status === 'running';

          return (
            <div class={styles.row}>
              <span class={styles.connector} aria-hidden="true">
                └
              </span>
              <div class={styles.rowContent}>
                <div class={styles.rowMain}>
                  <Show
                    when={isActive()}
                    fallback={
                      <Show
                        when={row().status === 'complete'}
                        fallback={
                          <span class={styles.statusIcon}>
                          <Icon
                            name="alert-circle"
                            size={12}
                              class={styles.errorIcon}
                            />
                          </span>
                        }
                      >
                        <span class={styles.statusIcon}>
                          <Icon
                            name="check"
                            size={12}
                            class={styles.completeIcon}
                          />
                        </span>
                      </Show>
                    }
                  >
                    <span class={`${styles.statusDot} ${styles.active}`} />
                  </Show>
                  <span
                    class={`${styles.toolName} ${isActive() ? styles.active : ''}`}
                  >
                    {row().name}
                  </span>
                  <Show when={row().argumentPreview}>
                    <span class={styles.argumentPreview}>
                      {row().argumentPreview}
                    </span>
                  </Show>
                  <Show when={row().durationMs != null}>
                    <span class={styles.duration}>
                      {formatDuration(row().durationMs!)}
                    </span>
                  </Show>
                </div>
                <Show when={row().resultSummary}>
                  <div class={styles.resultSummary}>{row().resultSummary}</div>
                </Show>
              </div>
            </div>
          );
        }}
      </Index>
    </div>
  );
};

export { ToolCallTree };
