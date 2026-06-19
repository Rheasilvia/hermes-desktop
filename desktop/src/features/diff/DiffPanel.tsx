import type { Component } from 'solid-js';
import { Show, Switch, Match, createEffect, createMemo, createSignal, onCleanup } from 'solid-js';
import type { FileStatus, GitDiffResult } from '@/types/diff.js';
import { Icon } from '@/ui/atoms/Icon.js';
import { DiffSummary } from './DiffSummary.js';
import { DiffContent } from './DiffContent.js';
import { DiffFileNavigator } from './DiffFileNavigator.js';
import { buildDiffFileRows } from './diff-file-navigator-model.js';
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

const STATUS_DOT_CLASS: Record<FileStatus, string> = {
  added: styles.statusAdded,
  modified: styles.statusModified,
  deleted: styles.statusDeleted,
  renamed: styles.statusRenamed,
};

export const DiffPanel: Component<DiffPanelProps> = (props) => {
  const [fileDrawerOpen, setFileDrawerOpen] = createSignal(false);
  const fileRows = createMemo(() =>
    props.data ? buildDiffFileRows(props.data.files) : [],
  );
  const activeIndex = () => {
    const count = props.data?.files.length ?? 0;
    if (count === 0) return 0;
    const requestedIndex = props.activeFileIndex ?? 0;
    return Math.min(Math.max(requestedIndex, 0), count - 1);
  };
  const activeFileRow = createMemo(() => fileRows()[activeIndex()] ?? null);
  const handleSelectFile = (index: number) => {
    props.onSelectFile?.(index);
    setFileDrawerOpen(false);
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
          <Show when={(props.data?.files?.length ?? 0) > 0}>
            <div class={styles.diffPanelHeader}>
              <div class={styles.diffPanelTitle}>Git changes</div>
              <div class={styles.diffPanelHeaderRight}>
                <Show when={props.data && !props.error}>
                  <DiffSummary summary={props.data!.summary} />
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
                        </div>
                      )}
                    </Show>
                    <DiffContent files={props.data!.files} activeIndex={activeIndex()} onSelectFile={handleSelectFile} />
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
