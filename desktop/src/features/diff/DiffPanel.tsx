import type { Component } from 'solid-js';
import { Show, Switch, Match } from 'solid-js';
import type { GitDiffResult } from '@/types/diff.js';
import { Icon } from '@/ui/atoms/Icon.js';
import { DiffSummary } from './DiffSummary.js';
import { DiffContent } from './DiffContent.js';
import styles from './DiffPanel.module.css';

interface DiffPanelProps {
  visible: boolean;
  data: GitDiffResult | null;
  loading: boolean;
  error: string | null;
  panelWidth: number;
  hasWorkspace: boolean;
  onClose: () => void;
  onAddWorkspace: () => void;
}

export const DiffPanel: Component<DiffPanelProps> = (props) => {
  return (
    <div
      ref={(el) => {
        if (typeof props.ref === 'function') (props.ref as (el: HTMLDivElement) => void)(el);
      }}
      class={styles.diffPanel}
      style={{
        width: props.visible ? `${props.panelWidth}px` : '0',
        'min-width': props.visible ? '320px' : '0',
        opacity: props.visible ? 1 : 0,
      }}
    >
      <Show when={props.visible}>
        <Show when={!props.hasWorkspace}>
          {/* Empty state: no workspace selected */}
          <div class={styles.diffEmptyState}>
            <div class={styles.diffEmptyIcon}>
              <Icon name="folder-open" size={32} />
            </div>
            <div class={styles.diffEmptyTitle}>No workspace selected</div>
            <div class={styles.diffEmptyBody}>
              Select a workspace first to view git changes.
            </div>
            <button
              type="button"
              class={styles.diffAddWorkspaceBtn}
              onClick={props.onAddWorkspace}
            >
              <Icon name="folder-open" size={14} />
              <span>Add Workspace</span>
            </button>
          </div>
        </Show>
        <Show when={props.hasWorkspace}>
          <Show when={(props.data?.files?.length ?? 0) > 0}>
            <div class={styles.diffPanelHeader}>
              <div class={styles.diffPanelHeaderSpacer} />
              <div class={styles.diffPanelHeaderRight}>
                <Show when={props.data && !props.error}>
                  <DiffSummary summary={props.data!.summary} />
                </Show>
                <button
                  type="button"
                  class={styles.diffCloseBtn}
                  onClick={props.onClose}
                  aria-label="Close diff panel"
                >
                  <Icon name="x" size={16} />
                </button>
              </div>
            </div>
          </Show>

        <div class={styles.diffPanelBody}>
          <Switch fallback={null}>
            <Match when={props.loading}>
              <div class={styles.diffEmptyState}>Loading diff...</div>
            </Match>
            <Match when={props.error}>
              <div class={styles.diffErrorState}>
                <div class={styles.diffErrorTitle}>Error</div>
                <div class={styles.diffErrorBody}>{props.error}</div>
              </div>
            </Match>
            <Match when={!props.data || props.data.files.length === 0}>
              <div class={styles.diffEmptyState}>
                <div class={styles.diffEmptyTitle}>
                  {props.data && !props.data.working_dir ? 'No git repository' : 'Working tree clean'}
                </div>
                <div class={styles.diffEmptyBody}>
                  {props.data && !props.data.working_dir
                    ? 'The current workspace is not a git repository. Initialize one with `git init` to see diffs here.'
                    : 'No unstaged changes found.'}
                </div>
              </div>
            </Match>
            <Match when={props.data && props.data.files.length > 0}>
              <DiffContent files={props.data!.files} />
            </Match>
          </Switch>
        </div>
        </Show>
      </Show>
    </div>
  );
};
