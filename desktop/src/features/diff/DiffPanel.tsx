import type { Component } from 'solid-js';
import { Show, Switch, Match, createEffect, createMemo, createSignal, onCleanup } from 'solid-js';
import type { FileStatus, GitDiffResult } from '@/types/diff.js';
import type { ReviewFile, ReviewFilesResult } from '@/types/review.js';
import { Icon } from '@/ui/atoms/Icon.js';
import { DiffSummary } from './DiffSummary.js';
import { DiffContent } from './DiffContent.js';
import { DiffFileNavigator } from './DiffFileNavigator.js';
import { buildDiffFileRows, buildReviewFileRows } from './diff-file-navigator-model.js';
import styles from './DiffPanel.module.css';

interface DiffPanelProps {
  visible: boolean;
  data: GitDiffResult | null;
  loading: boolean;
  error: string | null;
  hasWorkspace: boolean;
  activeFileIndex?: number;
  reviewData?: ReviewFilesResult | null;
  selectedReviewPath?: string | null;
  actionBusyKey?: string | null;
  commitMessage?: string;
  commitMessageLoading?: boolean;
  commitMessageError?: string | null;
  onSelectFile?: (index: number) => void;
  onSelectReviewFile?: (path: string) => void;
  onStageFile?: (path: string) => void;
  onUnstageFile?: (path: string) => void;
  onRevertFile?: (path: string) => void;
  onCommitMessageChange?: (message: string) => void;
  onGenerateCommitMessage?: () => void;
  onCancelGenerateCommitMessage?: () => void;
  onCommit?: (message: string) => void;
  onPush?: () => void;
  onCreatePr?: () => void;
}

const STATUS_DOT_CLASS: Record<FileStatus, string> = {
  added: styles.statusAdded,
  modified: styles.statusModified,
  deleted: styles.statusDeleted,
  renamed: styles.statusRenamed,
};

export const DiffPanel: Component<DiffPanelProps> = (props) => {
  const [fileDrawerOpen, setFileDrawerOpen] = createSignal(false);
  const fileRows = createMemo(() => {
    if (props.reviewData) return buildReviewFileRows(props.reviewData.files);
    return props.data ? buildDiffFileRows(props.data.files) : [];
  });
  const hasReview = () => props.reviewData != null;
  const hasFileRows = () => fileRows().length > 0;
  const activeIndex = () => {
    const count = fileRows().length;
    if (count === 0) return 0;
    if (props.reviewData) {
      const selectedPath = props.selectedReviewPath;
      const selectedIndex = selectedPath
        ? fileRows().findIndex((row) => row.path === selectedPath)
        : -1;
      return selectedIndex >= 0 ? selectedIndex : 0;
    }
    const requestedIndex = props.activeFileIndex ?? 0;
    return Math.min(Math.max(requestedIndex, 0), count - 1);
  };
  const activeFileRow = createMemo(() => fileRows()[activeIndex()] ?? null);
  const activeReviewFile = createMemo<ReviewFile | null>(() => {
    if (!props.reviewData) return null;
    const row = activeFileRow();
    if (!row) return null;
    return props.reviewData.files.find((file) => file.path === row.path) ?? null;
  });
  const summary = createMemo(() => props.reviewData?.summary ?? props.data?.summary ?? null);
  const commitMessage = () => props.commitMessage ?? '';
  const canCommit = () =>
    Boolean(props.reviewData?.summary.staged_count)
    && commitMessage().trim().length > 0
    && props.actionBusyKey !== 'commit';
  const handleSelectFile = (index: number) => {
    if (props.reviewData) {
      const row = fileRows()[index];
      if (row) props.onSelectReviewFile?.(row.path);
    } else {
      props.onSelectFile?.(index);
    }
    setFileDrawerOpen(false);
  };
  const handleRevert = (path: string) => {
    if (!window.confirm(`Revert changes in ${path}?`)) return;
    props.onRevertFile?.(path);
  };

  createEffect(() => {
    if (!fileDrawerOpen()) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setFileDrawerOpen(false);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    onCleanup(() => document.removeEventListener('keydown', handleKeyDown));
  });

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
          <Show when={hasFileRows()}>
            <div class={styles.diffPanelHeader}>
              <div class={styles.diffPanelTitle}>{hasReview() ? 'Review' : 'Git changes'}</div>
              <div class={styles.diffPanelHeaderRight}>
                <Show when={summary() && !props.error}>
                  <DiffSummary summary={summary()!} />
                </Show>
                <button
                  type="button"
                  class={styles.diffHeaderFilesButton}
                  aria-label={`Open changed files (${fileRows().length})`}
                  title="Open changed files"
                  onClick={() => setFileDrawerOpen(true)}
                >
                  <Icon name="file" size={13} strokeWidth={1.7} />
                  <span>Files</span>
                  <span class={styles.diffHeaderFilesCount}>{fileRows().length}</span>
                </button>
              </div>
            </div>
          </Show>
          <Show when={props.reviewData}>
            <div class={styles.reviewShipBar}>
              <input
                class={styles.reviewCommitInput}
                aria-label="Commit message"
                value={commitMessage()}
                placeholder="Commit message"
                onInput={(event) => props.onCommitMessageChange?.(event.currentTarget.value)}
              />
              <Show
                when={props.commitMessageLoading}
                fallback={
                  <button
                    type="button"
                    class={styles.reviewActionButton}
                    onClick={() => props.onGenerateCommitMessage?.()}
                  >
                    Generate
                  </button>
                }
              >
                <button
                  type="button"
                  class={styles.reviewActionButton}
                  onClick={() => props.onCancelGenerateCommitMessage?.()}
                >
                  Cancel
                </button>
              </Show>
              <button
                type="button"
                class={styles.reviewActionButtonPrimary}
                disabled={!canCommit()}
                onClick={() => props.onCommit?.(commitMessage())}
              >
                Commit
              </button>
              <button
                type="button"
                class={styles.reviewActionButton}
                disabled={props.actionBusyKey === 'push'}
                onClick={() => props.onPush?.()}
              >
                Push
              </button>
              <button
                type="button"
                class={styles.reviewActionButton}
                disabled={props.actionBusyKey === 'pr'}
                onClick={() => props.onCreatePr?.()}
              >
                PR
              </button>
            </div>
            <Show when={props.commitMessageError}>
              <div class={styles.reviewInlineError} role="alert">{props.commitMessageError}</div>
            </Show>
          </Show>

          <div class={styles.diffPanelBody}>
            <Switch fallback={null}>
              <Match when={props.loading && !hasFileRows()}>
                <div class={styles.diffEmptyState}>Loading diff...</div>
              </Match>
              <Match when={props.error}>
                <div class={styles.diffErrorState}>
                  <div class={styles.diffErrorTitle}>Error</div>
                  <div class={styles.diffErrorBody}>{props.error}</div>
                </div>
              </Match>
              <Match when={!hasFileRows()}>
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
              <Match when={hasFileRows()}>
                <div class={styles.diffReviewBody}>
                  <aside class={styles.diffFileRail} aria-label="Changed files rail">
                    <DiffFileNavigator
                      rows={fileRows()}
                      activeIndex={activeIndex()}
                      ariaLabel="Changed files"
                      onSelect={handleSelectFile}
                    />
                  </aside>
                  <section class={styles.diffMainPane} aria-label="Selected file diff">
                    <Show when={activeFileRow()}>
                      {(row) => (
                        <div class={styles.diffCurrentFileBar}>
                          <span class={`${styles.statusDot} ${STATUS_DOT_CLASS[row().status]}`} />
                          <span class={styles.diffCurrentFileText}>
                            <span class={styles.diffCurrentFileName}>{row().basename}</span>
                            <Show when={row().dirname}>
                              <span class={styles.diffCurrentFileDir}>{row().dirname}</span>
                            </Show>
                          </span>
                          <Show when={activeReviewFile()}>
                            {(file) => (
                              <span class={styles.reviewFileActions}>
                                <Show when={file().unstaged || file().untracked}>
                                  <button
                                    type="button"
                                    class={styles.reviewMiniButton}
                                    disabled={props.actionBusyKey === `stage:${file().path}`}
                                    onClick={() => props.onStageFile?.(file().path)}
                                  >
                                    Stage
                                  </button>
                                </Show>
                                <Show when={file().staged}>
                                  <button
                                    type="button"
                                    class={styles.reviewMiniButton}
                                    disabled={props.actionBusyKey === `unstage:${file().path}`}
                                    onClick={() => props.onUnstageFile?.(file().path)}
                                  >
                                    Unstage
                                  </button>
                                </Show>
                                <Show when={file().unstaged || file().untracked}>
                                  <button
                                    type="button"
                                    class={styles.reviewMiniButtonDanger}
                                    disabled={props.actionBusyKey === `revert:${file().path}`}
                                    onClick={() => handleRevert(file().path)}
                                  >
                                    Revert
                                  </button>
                                </Show>
                              </span>
                            )}
                          </Show>
                        </div>
                      )}
                    </Show>
                    <Show
                      when={!props.loading}
                      fallback={<div class={styles.diffEmptyState}>Loading diff...</div>}
                    >
                      <DiffContent
                        files={props.data?.files ?? []}
                        activeIndex={props.reviewData ? 0 : activeIndex()}
                        onSelectFile={handleSelectFile}
                      />
                    </Show>
                  </section>
                  <Show when={fileDrawerOpen()}>
                    <div
                      class={styles.diffFileDrawerBackdrop}
                      data-testid="diff-file-drawer-backdrop"
                      onPointerDown={() => setFileDrawerOpen(false)}
                    >
                      <div
                        class={styles.diffFileDrawer}
                        role="dialog"
                        aria-label="Changed files"
                        onPointerDown={(event) => event.stopPropagation()}
                      >
                        <DiffFileNavigator
                          rows={fileRows()}
                          activeIndex={activeIndex()}
                          ariaLabel="Changed files drawer"
                          onSelect={handleSelectFile}
                          onClose={() => setFileDrawerOpen(false)}
                        />
                      </div>
                    </div>
                  </Show>
                </div>
              </Match>
            </Switch>
          </div>
        </Show>
      </Show>
    </div>
  );
};
