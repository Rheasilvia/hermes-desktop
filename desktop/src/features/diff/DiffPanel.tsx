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
  hasWorkspace: boolean;
  activeFileIndex?: number;
  onSelectFile?: (index: number) => void;
}

export const DiffPanel: Component<DiffPanelProps> = (props) => {
  return (
    <div class={styles.diffPanel}>
      <Show when={props.visible}>
        <Show when={!props.hasWorkspace}>
          <div class={styles.diffEmptyState}>
            <div class={styles.diffEmptyIcon}>
              <Icon name="folder-open" size={32} />
            </div>
            <div class={styles.diffEmptyTitle}>No workspace selected</div>
            <div class={styles.diffEmptyBody}>
              Select a workspace first to view git changes.
            </div>
          </div>
        </Show>
        <Show when={props.hasWorkspace}>
          <Show when={(props.data?.files?.length ?? 0) > 0}>
            <div class={styles.diffPanelHeader}>
              <div class={styles.diffPanelTitle}>Git changes</div>
              <div class={styles.diffPanelHeaderRight}>
                <Show when={props.data && !props.error}>
                  <DiffSummary summary={props.data!.summary} />
                </Show>
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
              <DiffContent files={props.data!.files} activeIndex={props.activeFileIndex} onSelectFile={props.onSelectFile} />
            </Match>
          </Switch>
        </div>
        </Show>
      </Show>
    </div>
  );
};
