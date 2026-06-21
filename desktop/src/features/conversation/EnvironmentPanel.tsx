import type { Component } from 'solid-js';
import { For, Show } from 'solid-js';
import { Icon } from '@/ui/atoms/Icon.js';
import { createEnvironmentPanelController } from './environmentPanelController.js';
import styles from './EnvironmentPanel.module.css';

interface EnvironmentPanelProps {
  sessionId: string | null;
  workspacePath: string | null;
}

export const EnvironmentPanel: Component<EnvironmentPanelProps> = (props) => {
  const controller = createEnvironmentPanelController(props);

  return (
    <section class={styles.shell} aria-label="Environment panel">
      <div class={styles.card}>
        <header class={styles.header}>
          <h2 class={styles.title}>Environment</h2>
          <button
            type="button"
            class={styles.addButton}
            aria-label="Add environment tool"
            title="Add tool tab"
            onClick={controller.requestAddTool}
          >
            <Icon name="plus" size={16} strokeWidth={1.7} />
          </button>
        </header>

        <div class={styles.rows}>
          <button type="button" class={styles.row} onClick={controller.openReview} aria-label="Open git changes">
            <span class={styles.iconSlot}><Icon name="clipboard-list" size={16} strokeWidth={1.7} /></span>
            <span class={styles.rowText}>
              <span class={styles.rowTitle}>Changes</span>
            </span>
            <span class={styles.changeStats} aria-label="Change summary">
              <Show when={controller.diffSummary()} fallback={<span class={styles.mutedValue}>No diff</span>}>
                {(summary) => (
                  <>
                    <span class={styles.insertions}>+{summary().insertions.toLocaleString()}</span>
                    <span class={styles.deletions}>-{summary().deletions.toLocaleString()}</span>
                  </>
                )}
              </Show>
            </span>
          </button>

          <button type="button" class={styles.row} onClick={controller.openFiles} aria-label="Open local workspace">
            <span class={styles.iconSlot}><Icon name="monitor" size={16} strokeWidth={1.7} /></span>
            <span class={styles.rowText}>
              <span class={styles.rowTitle}>Local</span>
              <span class={styles.rowSubtitle} title={props.workspacePath ?? undefined}>{controller.workspaceName()}</span>
            </span>
            <Icon name="chevron-right" size={14} class={styles.trailingIcon} />
          </button>

          <div class={styles.branchRoot} ref={controller.setBranchRoot}>
            <button
              type="button"
              class={styles.row}
              classList={{ [styles.rowDisabled]: controller.branchDisabled() }}
              disabled={controller.branchDisabled()}
              onClick={controller.toggleBranchMenu}
              aria-label="Switch git branch"
              aria-haspopup="menu"
              aria-expanded={controller.branchMenuOpen()}
            >
              <span class={styles.iconSlot}><Icon name="git-branch" size={16} strokeWidth={1.7} /></span>
              <span class={styles.rowText}>
                <span class={styles.rowTitle}>{controller.branchLabel()}</span>
                <Show when={controller.branchError()}>
                  <span class={styles.rowSubtitle}>{controller.branchError()}</span>
                </Show>
              </span>
              <Icon name="chevron-down" size={14} class={styles.trailingIcon} />
            </button>
            <Show when={controller.branchMenuOpen()}>
              <div class={styles.branchMenu} role="menu" aria-label="Git branches">
                <For each={controller.branches()}>
                  {(branch) => (
                    <button
                      type="button"
                      class={styles.branchItem}
                      classList={{ [styles.branchItemCurrent]: branch === controller.currentBranch() }}
                      role="menuitem"
                      onClick={() => void controller.selectBranch(branch)}
                    >
                      <span
                        class={styles.checkSlot}
                        classList={{ [styles.checkSlotVisible]: branch === controller.currentBranch() }}
                      >
                        <Icon name="check" size={12} strokeWidth={2} />
                      </span>
                      <span class={styles.branchName}>{branch}</span>
                    </button>
                  )}
                </For>
              </div>
            </Show>
          </div>

          <button
            type="button"
            class={`${styles.row} ${styles.rowDisabled}`}
            disabled
            aria-label="Commit or push unavailable"
          >
            <span class={styles.iconSlot}><Icon name="git-pull-request" size={16} strokeWidth={1.7} /></span>
            <span class={styles.rowText}>
              <span class={styles.rowTitle}>Commit or push</span>
            </span>
          </button>

          <button
            type="button"
            class={`${styles.row} ${styles.rowDisabled}`}
            disabled
            aria-label="GitHub CLI unavailable"
          >
            <span class={styles.iconSlot}><Icon name="terminal" size={16} strokeWidth={1.7} /></span>
            <span class={styles.rowText}>
              <span class={styles.rowTitle}>GitHub CLI unavailable</span>
            </span>
          </button>
        </div>

        <div class={styles.divider} />

        <section class={styles.sourcesSection} aria-label="Sources">
          <h3 class={styles.sectionTitle}>Sources</h3>
          <button type="button" class={styles.row} onClick={controller.openFiles} aria-label="Open source workspace">
            <span class={styles.iconSlot}><Icon name="code" size={16} strokeWidth={1.7} /></span>
            <span class={styles.rowText}>
              <span class={styles.rowTitle}>{controller.workspaceName()}</span>
              <span class={styles.rowSubtitle} title={props.workspacePath ?? undefined}>
                {props.workspacePath ?? 'No workspace selected'}
              </span>
            </span>
            <Icon name="chevron-right" size={14} class={styles.trailingIcon} />
          </button>
        </section>
      </div>
    </section>
  );
};
