import type { Component, JSX } from 'solid-js';
import { For, Show, Switch, Match, createEffect, createMemo, createSignal, onCleanup } from 'solid-js';
import type { FileStatus, GitDiffResult } from '@/types/diff.js';
import type { ReviewFile, ReviewFilesResult, ReviewShipInfoResult } from '@/types/review.js';
import {
  REVIEW_FILE_RAIL_DEFAULT_WIDTH,
  REVIEW_FILE_RAIL_MIN_WIDTH,
  REVIEW_SPLIT_HANDLE_WIDTH,
  clampReviewFileRailWidth,
  maxReviewFileRailWidth,
  shouldUseReviewSplit,
} from '@/lib/review-split-layout.js';
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
  /** True while ANY review mutation is in flight — disables all mutation buttons. */
  actionInFlight?: boolean;
  /** Append-only action history for the collapsible status panel. */
  actionLog?: Array<{ id: number; kind: string; status: 'success' | 'failed'; message: string; at: number }>;
  onClearActionLog?: () => void;
  /** When true, the PR button is disabled (e.g. current branch is the repo default). */
  prDisabled?: boolean;
  prDisabledReason?: string | null;
  createdPrUrl?: string | null;
  shipInfo?: ReviewShipInfoResult | null;
  onOpenPrUrl?: (url: string) => void;
  commitMessage?: string;
  commitMessageLoading?: boolean;
  commitMessageError?: string | null;
  reviewFileRailWidth?: number;
  onReviewFileRailWidthChange?: (width: number) => void;
  onResetReviewFileRailWidth?: () => void;
  onSelectFile?: (index: number) => void;
  onSelectReviewFile?: (path: string) => void;
  onStageFile?: (path: string) => void;
  onUnstageFile?: (path: string) => void;
  onRevertFile?: (path: string) => void;
  onRefresh?: () => void;
  onStageAll?: () => void;
  onRevertAll?: () => void;
  showInstallAction?: boolean;
  installActionBusy?: boolean;
  onInstallAction?: () => void;
  retryActionBusy?: boolean;
  onRetryAction?: () => void;
  onCommitMessageChange?: (message: string) => void;
  onGenerateCommitMessage?: () => void;
  onCancelGenerateCommitMessage?: () => void;
  onCommit?: (message: string) => void;
  onCommitPush?: (message: string) => void;
  onPush?: () => void;
  onCreatePr?: () => void;
  onCommitPushCreatePr?: (message: string) => void;
  onAskHermes?: () => void;
}

const STATUS_DOT_CLASS: Record<FileStatus, string> = {
  added: styles.statusAdded,
  modified: styles.statusModified,
  deleted: styles.statusDeleted,
  renamed: styles.statusRenamed,
};

interface ReviewStatusPanelProps {
  actionLog?: Array<{ id: number; kind: string; status: 'success' | 'failed'; message: string; at: number }>;
  createdPrUrl?: string | null;
  onOpenPrUrl?: (url: string) => void;
  onClear?: () => void;
}

// Collapsible status panel. Collapsed: a single quiet line summarizing the last
// action (✓ Committed, or ✗ <failed message>). Expanded: the recent action
// history with failed rows highlighted. This replaces the old alert-style error
// banner — failures are reported inline here, never as a modal alert.
const ReviewStatusPanel: Component<ReviewStatusPanelProps> = (props) => {
  const [open, setOpen] = createSignal(false);
  const log = () => props.actionLog ?? [];
  const last = () => {
    const entries = log();
    return entries.length > 0 ? entries[entries.length - 1] : null;
  };
  const failedCount = () => log().filter((entry) => entry.status === 'failed').length;
  const hasContent = () => log().length > 0 || Boolean(props.createdPrUrl);

  return (
    <Show when={hasContent()}>
      <div class={styles.statusPanel}>
        <button
          type="button"
          class={styles.statusPanelHeader}
          aria-expanded={open()}
          onClick={() => setOpen((v) => !v)}
        >
          <Show when={last()} fallback={
            <span class={styles.statusPanelSummarySuccess}>
              <Icon name="check" size={12} /> Pull request created
            </span>
          }>
            {(entry) => entry().status === 'success' ? (
              <span class={styles.statusPanelSummarySuccess}>
                <Icon name="check" size={12} /> {entry().message}
              </span>
            ) : (
              <span class={styles.statusPanelSummaryFailed}>
                <Icon name="x" size={12} /> {entry().message}
              </span>
            )}
          </Show>
          <Show when={failedCount() > 0}>
            <span class={styles.statusPanelBadge}>{failedCount()} failed</span>
          </Show>
          <span class={`${styles.statusPanelChevron} ${open() ? styles.statusPanelChevronOpen : ''}`}>
            <Icon name="chevron-down" size={12} />
          </span>
        </button>
        <Show when={open()}>
          <div class={styles.statusPanelBody}>
            <Show when={props.createdPrUrl}>
              <div class={styles.statusPanelPrLink}>
                <span>PR —</span>
                <button
                  type="button"
                  class={styles.reviewInlineLink}
                  onClick={() => props.createdPrUrl && props.onOpenPrUrl?.(props.createdPrUrl)}
                >
                  open {props.createdPrUrl}
                </button>
              </div>
            </Show>
            <For each={[...log()].reverse()}>
              {(entry) => (
                <div class={`${styles.statusPanelRow} ${entry.status === 'failed' ? styles.statusPanelRowFailed : ''}`}>
                  <Icon name={entry.status === 'success' ? 'check' : 'x'} size={11} />
                  <span>{entry.message}</span>
                </div>
              )}
            </For>
            <Show when={props.onClear && log().length > 0}>
              <button type="button" class={styles.statusPanelClear} onClick={() => props.onClear?.()}>
                Clear history
              </button>
            </Show>
          </div>
        </Show>
      </div>
    </Show>
  );
};

export const DiffPanel: Component<DiffPanelProps> = (props) => {
  let reviewBodyRef: HTMLDivElement | undefined;
  let reviewBodyResizeObserver: ResizeObserver | null = null;
  let pendingReviewRailDragWidth: number | null = null;
  let reviewRailDragFrame: number | null = null;
  let activeReviewSplitCancel: (() => void) | null = null;
  const [fileDrawerOpen, setFileDrawerOpen] = createSignal(false);
  const [shipOpen, setShipOpen] = createSignal(false);
  const [shipIntent, setShipIntent] = createSignal<'commit' | 'pr'>('commit');
  const [reviewBodyWidth, setReviewBodyWidth] = createSignal(0);
  const [localReviewFileRailWidth, setLocalReviewFileRailWidth] = createSignal(REVIEW_FILE_RAIL_DEFAULT_WIDTH);
  const [reviewRailDragWidth, setReviewRailDragWidth] = createSignal<number | null>(null);
  let autoGenerateRequested = false;
  const fileRows = createMemo(() => {
    if (props.reviewData) return buildReviewFileRows(props.reviewData.files);
    return props.data ? buildDiffFileRows(props.data.files) : [];
  });
  const hasReview = () => props.reviewData != null;
  const hasFileRows = () => fileRows().length > 0;
  // Whether the inline diff body (DiffContent) has a previous file's content to
  // keep showing while the next one loads. The store leaves the prior diff on
  // `diffData` during a cache-miss fetch, so this lets us hold the previous diff
  // instead of flashing the white "Loading diff..." empty state.
  const hasDiffContent = () => (props.data?.files?.length ?? 0) > 0;
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
  const showShipControls = () => props.reviewData != null && hasFileRows();
  const splitContainerWidth = () => reviewBodyWidth() || 960;
  const splitLayoutActive = () => hasFileRows() && shouldUseReviewSplit(splitContainerWidth());
  const preferredReviewFileRailWidth = () => props.reviewFileRailWidth ?? localReviewFileRailWidth();
  const effectiveReviewFileRailWidth = () =>
    clampReviewFileRailWidth(reviewRailDragWidth() ?? preferredReviewFileRailWidth(), splitContainerWidth());
  const reviewFileRailMaxWidth = () => maxReviewFileRailWidth(splitContainerWidth());
  const reviewShipPopoverRight = () =>
    splitLayoutActive()
      ? effectiveReviewFileRailWidth() + REVIEW_SPLIT_HANDLE_WIDTH + 12
      : 12;
  const reviewPanelStyle = createMemo<JSX.CSSProperties>(() => ({
    '--review-file-rail-width': `${effectiveReviewFileRailWidth()}px`,
    '--review-split-handle-width': `${REVIEW_SPLIT_HANDLE_WIDTH}px`,
    '--review-ship-popover-right': `${reviewShipPopoverRight()}px`,
    '--review-ship-popover-max-width': splitLayoutActive()
      ? `calc(100% - ${reviewShipPopoverRight() + 12}px)`
      : 'calc(100% - 24px)',
  } as JSX.CSSProperties));
  const unstagedCount = () => props.reviewData?.summary.unstaged_count ?? 0;
  const stagedCount = () => props.reviewData?.summary.staged_count ?? 0;
  const hasUnstagedChanges = () => unstagedCount() > 0 || (props.reviewData?.summary.untracked_count ?? 0) > 0;
  const existingPrUrl = () => props.shipInfo?.pr_url ?? props.createdPrUrl ?? null;
  // A button is disabled if its own action is running OR any other mutation is
  // in flight (the global guard prevents overlapping actions racing the refresh).
  const busy = (key: string) => props.actionInFlight === true || props.actionBusyKey === key;
  const canCommit = () =>
    showShipControls()
    && commitMessage().trim().length > 0
    && !busy('commit');
  const canCreatePr = () =>
    !busy('pr') && props.prDisabled !== true && (props.shipInfo?.can_create_pr ?? true);
  const createPrTitle = () => {
    if (props.prDisabled) return props.prDisabledReason ?? 'Cannot create a PR from this branch';
    if (props.shipInfo && !props.shipInfo.gh_available) return 'GitHub CLI (gh) is not available';
    if (props.shipInfo && !props.shipInfo.can_create_pr && !existingPrUrl()) return 'Cannot create a PR from this branch';
    return existingPrUrl() ? 'Open pull request' : 'Create pull request';
  };
  const openShip = (intent: 'commit' | 'pr' = 'commit') => {
    setShipIntent(intent);
    setShipOpen(true);
  };
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
  const handleRevertAll = () => {
    const count = fileRows().length;
    if (count === 0) return;
    if (!window.confirm(`Revert all ${count} changed ${count === 1 ? 'file' : 'files'}?`)) return;
    props.onRevertAll?.();
  };
  const handleCreatePrClick = () => {
    const url = existingPrUrl();
    if (url) {
      props.onOpenPrUrl?.(url);
      return;
    }
    if (hasFileRows()) {
      openShip('pr');
      return;
    }
    props.onCreatePr?.();
  };
  const setPreferredReviewFileRailWidth = (width: number) => {
    const nextWidth = clampReviewFileRailWidth(width, splitContainerWidth());
    if (props.onReviewFileRailWidthChange) {
      props.onReviewFileRailWidthChange(nextWidth);
    } else {
      setLocalReviewFileRailWidth(nextWidth);
    }
  };
  const resetPreferredReviewFileRailWidth = () => {
    if (props.onResetReviewFileRailWidth) {
      props.onResetReviewFileRailWidth();
    } else {
      setLocalReviewFileRailWidth(REVIEW_FILE_RAIL_DEFAULT_WIDTH);
    }
  };
  const measureReviewBody = (width?: number) => {
    setReviewBodyWidth(Math.max(0, Math.ceil(width ?? reviewBodyRef?.clientWidth ?? 0)));
  };
  const setReviewBodyRef = (element: HTMLDivElement) => {
    reviewBodyRef = element;
    measureReviewBody();
    reviewBodyResizeObserver?.disconnect();
    reviewBodyResizeObserver = null;
    if (typeof ResizeObserver === 'undefined') return;
    reviewBodyResizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      measureReviewBody(entry?.contentRect.width);
    });
    reviewBodyResizeObserver.observe(element);
  };
  const scheduleReviewRailDragWidth = (width: number) => {
    pendingReviewRailDragWidth = width;
    if (reviewRailDragFrame !== null) return;
    reviewRailDragFrame = requestAnimationFrame(() => {
      reviewRailDragFrame = null;
      const nextWidth = pendingReviewRailDragWidth;
      pendingReviewRailDragWidth = null;
      if (nextWidth !== null) {
        setReviewRailDragWidth(nextWidth);
      }
    });
  };
  const flushReviewRailDragWidth = (fallbackWidth: number) => {
    const nextWidth = pendingReviewRailDragWidth ?? fallbackWidth;
    if (reviewRailDragFrame !== null) {
      cancelAnimationFrame(reviewRailDragFrame);
      reviewRailDragFrame = null;
    }
    pendingReviewRailDragWidth = null;
    setReviewRailDragWidth(nextWidth);
    return nextWidth;
  };
  const cancelReviewRailDragWidth = () => {
    if (reviewRailDragFrame !== null) {
      cancelAnimationFrame(reviewRailDragFrame);
      reviewRailDragFrame = null;
    }
    pendingReviewRailDragWidth = null;
    setReviewRailDragWidth(null);
  };
  const handleReviewSplitDragStart: JSX.EventHandler<HTMLDivElement, MouseEvent> = (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!splitLayoutActive()) return;
    activeReviewSplitCancel?.();

    const startX = event.clientX;
    const startWidth = effectiveReviewFileRailWidth();
    let lastWidth = startWidth;
    setReviewRailDragWidth(startWidth);

    const onMove = (moveEvent: MouseEvent) => {
      const delta = startX - moveEvent.clientX;
      lastWidth = clampReviewFileRailWidth(startWidth + delta, splitContainerWidth());
      scheduleReviewRailDragWidth(lastWidth);
    };

    let finished = false;
    let cancelDrag = () => {};
    const finish = (commit: boolean) => {
      if (finished) return;
      finished = true;
      if (commit) {
        const committedWidth = flushReviewRailDragWidth(lastWidth);
        setPreferredReviewFileRailWidth(committedWidth);
        setReviewRailDragWidth(null);
      } else {
        cancelReviewRailDragWidth();
      }
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      window.removeEventListener('blur', cancelDrag);
      if (activeReviewSplitCancel === cancelDrag) activeReviewSplitCancel = null;
    };

    const onUp = () => finish(true);
    cancelDrag = () => finish(false);
    activeReviewSplitCancel = cancelDrag;

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    window.addEventListener('blur', cancelDrag);
  };
  const handleReviewSplitKeyDown: JSX.EventHandler<HTMLDivElement, KeyboardEvent> = (event) => {
    if (!splitLayoutActive()) return;
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      setPreferredReviewFileRailWidth(effectiveReviewFileRailWidth() + 24);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      setPreferredReviewFileRailWidth(effectiveReviewFileRailWidth() - 24);
    } else if (event.key === 'Home') {
      event.preventDefault();
      setPreferredReviewFileRailWidth(REVIEW_FILE_RAIL_MIN_WIDTH);
    } else if (event.key === 'End') {
      event.preventDefault();
      setPreferredReviewFileRailWidth(reviewFileRailMaxWidth());
    } else if (event.key === 'Enter') {
      event.preventDefault();
      resetPreferredReviewFileRailWidth();
    }
  };

  createEffect(() => {
    if (!shipOpen()) {
      autoGenerateRequested = false;
      return;
    }
    if (autoGenerateRequested) return;
    if (!showShipControls()) return;
    if (commitMessage().trim()) return;
    if (props.commitMessageLoading) return;
    autoGenerateRequested = true;
    props.onGenerateCommitMessage?.();
  });

  createEffect(() => {
    if (splitLayoutActive() && fileDrawerOpen()) {
      setFileDrawerOpen(false);
    }
  });

  createEffect(() => {
    if (hasFileRows()) return;
    reviewBodyResizeObserver?.disconnect();
    reviewBodyResizeObserver = null;
    reviewBodyRef = undefined;
    setReviewBodyWidth(0);
  });

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

  onCleanup(() => {
    activeReviewSplitCancel?.();
    if (reviewRailDragFrame !== null) {
      cancelAnimationFrame(reviewRailDragFrame);
    }
    pendingReviewRailDragWidth = null;
    reviewBodyResizeObserver?.disconnect();
    reviewBodyResizeObserver = null;
  });

  return (
    <div
      class={styles.diffPanel}
      classList={{
        [styles.diffPanelSplitLayout]: splitLayoutActive(),
        [styles.diffPanelReviewSplitDragging]: reviewRailDragWidth() !== null,
      }}
      style={reviewPanelStyle()}
      data-review-split-dragging={reviewRailDragWidth() !== null ? 'true' : undefined}
      data-testid="diff-panel"
    >
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
              <div class={styles.diffPanelTitle}>
                {hasReview() ? (stagedCount() > 0 ? 'Staged' : 'Unstaged') : 'Git changes'}
              </div>
              <Show when={hasReview()}>
                <span class={styles.diffPanelCount}>{fileRows().length}</span>
              </Show>
              <div class={styles.diffPanelHeaderRight}>
                <Show when={summary() && !props.error}>
                  <DiffSummary summary={summary()!} />
                </Show>
                <Show when={hasReview()}>
                  <div class={styles.reviewToolbar} aria-label="Review actions">
                    <button
                      type="button"
                      class={styles.reviewIconButton}
                      aria-label="Refresh review"
                      title="Refresh"
                      disabled={props.loading}
                      onClick={() => props.onRefresh?.()}
                    >
                      <Icon name="refresh-cw" size={14} />
                    </button>
                    <button
                      type="button"
                      class={styles.reviewIconButton}
                      aria-label="Stage all changes"
                      title="Stage all"
                      disabled={!hasUnstagedChanges() || busy('stage:all')}
                      onClick={() => props.onStageAll?.()}
                    >
                      <Icon name="plus" size={14} />
                    </button>
                    <button
                      type="button"
                      class={styles.reviewIconButton}
                      aria-label="Revert all changes"
                      title="Revert all"
                      disabled={!hasFileRows() || busy('revert:all')}
                      onClick={handleRevertAll}
                    >
                      <Icon name="archive-restore" size={14} />
                    </button>
                    <button
                      type="button"
                      class={styles.reviewShipButton}
                      aria-label="Commit or push"
                      title="Commit or push"
                      disabled={!showShipControls()}
                      onClick={() => openShip('commit')}
                    >
                      <Icon name="git-branch" size={14} />
                    </button>
                    <button
                      type="button"
                      class={styles.reviewShipButton}
                      aria-label={existingPrUrl() ? 'Open PR' : 'Create PR'}
                      disabled={!canCreatePr() && !existingPrUrl()}
                      title={createPrTitle()}
                      onClick={handleCreatePrClick}
                    >
                      <Icon name="git-pull-request" size={14} />
                    </button>
                  </div>
                </Show>
                <button
                  type="button"
                  class={styles.diffHeaderFilesButton}
                  aria-label={`Open changed files (${fileRows().length})`}
                  title="Open changed files"
                  onClick={() => setFileDrawerOpen(true)}
                >
                  <Icon name="file" size={13} strokeWidth={1.7} />
                  <span class={styles.diffHeaderFilesLabel}>Files</span>
                  <span class={styles.diffHeaderFilesCount}>{fileRows().length}</span>
                </button>
              </div>
            </div>
          </Show>
          <div class={styles.diffPanelBody}>
            <Switch fallback={null}>
              <Match when={props.loading && !hasFileRows()}>
                <div class={styles.diffEmptyState}>Loading changes…</div>
              </Match>
              <Match when={props.error}>
                <div class={styles.diffEmptyState}>
                  <div class={styles.diffEmptyTitle}>
                    {props.showInstallAction ? 'Command Line Tools required' : 'Could not load changes'}
                  </div>
                  <div class={styles.diffEmptyBody}>{props.error}</div>
                  <Show when={props.showInstallAction || props.onRetryAction}>
                    <div class={styles.diffErrorActions}>
                      <Show when={props.showInstallAction}>
                        <button
                          type="button"
                          class={styles.reviewActionButtonPrimary}
                          disabled={props.installActionBusy || props.retryActionBusy}
                          onClick={() => props.onInstallAction?.()}
                        >
                          <Show when={props.installActionBusy} fallback={<Icon name="download" size={13} />}>
                            <Icon name="refresh-cw" size={13} />
                          </Show>
                          <span>{props.installActionBusy ? 'Opening installer…' : 'Install Command Line Tools'}</span>
                        </button>
                      </Show>
                      <Show when={props.onRetryAction}>
                        <button
                          type="button"
                          class={styles.reviewActionButton}
                          disabled={props.retryActionBusy || props.installActionBusy}
                          onClick={() => props.onRetryAction?.()}
                        >
                          <Icon name="refresh-cw" size={13} />
                          <span>{props.retryActionBusy ? 'Retrying…' : 'Retry'}</span>
                        </button>
                      </Show>
                    </div>
                  </Show>
                </div>
              </Match>
              <Match when={!hasFileRows()}>
                <div class={styles.diffEmptyState}>
                  <div class={styles.diffEmptyTitle}>{hasReview() ? 'No diffs' : 'Working tree clean'}</div>
                  <div class={styles.diffEmptyBody}>
                    {hasReview() ? 'Working tree clean' : 'No uncommitted changes to review.'}
                  </div>
                </div>
              </Match>
              <Match when={hasFileRows()}>
                <div
                  ref={(element) => setReviewBodyRef(element)}
                  class={styles.diffReviewBody}
                  classList={{ [styles.diffReviewBodySplit]: splitLayoutActive() }}
                  data-testid="review-split-body"
                >
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
                                    disabled={busy(`stage:${file().path}`)}
                                    onClick={() => props.onStageFile?.(file().path)}
                                  >
                                    {props.actionBusyKey === `stage:${file().path}` ? 'Staging…' : 'Stage'}
                                  </button>
                                </Show>
                                <Show when={file().staged}>
                                  <button
                                    type="button"
                                    class={styles.reviewMiniButton}
                                    disabled={busy(`unstage:${file().path}`)}
                                    onClick={() => props.onUnstageFile?.(file().path)}
                                  >
                                    {props.actionBusyKey === `unstage:${file().path}` ? 'Unstaging…' : 'Unstage'}
                                  </button>
                                </Show>
                                <Show when={file().unstaged || file().untracked}>
                                  <button
                                    type="button"
                                    class={styles.reviewMiniButtonDanger}
                                    disabled={busy(`revert:${file().path}`)}
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
                      when={!props.loading || hasDiffContent()}
                      fallback={<div class={styles.diffEmptyState}>Loading diff...</div>}
                    >
                      <DiffContent
                        files={props.data?.files ?? []}
                        activeIndex={props.reviewData ? 0 : activeIndex()}
                        onSelectFile={handleSelectFile}
                      />
                    </Show>
                  </section>
                  <Show when={splitLayoutActive()}>
                    <div
                      class={styles.reviewSplitHandle}
                      role="separator"
                      aria-label="Resize changed files pane"
                      aria-orientation="vertical"
                      aria-valuemin={REVIEW_FILE_RAIL_MIN_WIDTH}
                      aria-valuemax={reviewFileRailMaxWidth()}
                      aria-valuenow={effectiveReviewFileRailWidth()}
                      tabIndex={0}
                      onMouseDown={handleReviewSplitDragStart}
                      onDblClick={resetPreferredReviewFileRailWidth}
                      onKeyDown={handleReviewSplitKeyDown}
                      data-testid="review-split-handle"
                    />
                  </Show>
                  <aside class={styles.diffFileRail} aria-label="Changed files rail">
                    <DiffFileNavigator
                      rows={fileRows()}
                      activeIndex={activeIndex()}
                      ariaLabel="Changed files"
                      onSelect={handleSelectFile}
                      reviewFiles={props.reviewData?.files}
                      actionBusyKey={props.actionBusyKey}
                      actionInFlight={props.actionInFlight}
                      onStageFile={props.onStageFile}
                      onUnstageFile={props.onUnstageFile}
                      onRevertFile={props.onRevertFile}
                    />
                  </aside>
                  <Show when={fileDrawerOpen() && !splitLayoutActive()}>
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
                          reviewFiles={props.reviewData?.files}
                          actionBusyKey={props.actionBusyKey}
                          actionInFlight={props.actionInFlight}
                          onStageFile={props.onStageFile}
                          onUnstageFile={props.onUnstageFile}
                          onRevertFile={props.onRevertFile}
                        />
                      </div>
                    </div>
                  </Show>
                </div>
              </Match>
            </Switch>
          </div>
          <Show when={props.reviewData}>
            <ReviewStatusPanel
              actionLog={props.actionLog}
              createdPrUrl={props.createdPrUrl}
              onOpenPrUrl={props.onOpenPrUrl}
              onClear={props.onClearActionLog}
            />
            <Show when={showShipControls() && shipOpen()}>
              <div class={styles.reviewShipPopover} role="dialog" aria-label="Commit or push changes">
                <div class={styles.reviewShipPopoverHeader}>
                  <span>{shipIntent() === 'pr' ? 'Commit, push, and open PR' : 'Commit or push'}</span>
                  <button
                    type="button"
                    class={styles.reviewIconButton}
                    aria-label="Close commit panel"
                    title="Close"
                    onClick={() => setShipOpen(false)}
                  >
                    <Icon name="x" size={14} />
                  </button>
                </div>
                <div class={styles.reviewCommitWrap}>
                  <textarea
                    class={styles.reviewCommitInput}
                    aria-label="Commit message"
                    value={commitMessage()}
                    placeholder={props.commitMessageLoading ? 'Generating commit message...' : 'Commit message'}
                    rows={1}
                    onInput={(event) => props.onCommitMessageChange?.(event.currentTarget.value)}
                  />
                  <Show
                    when={props.commitMessageLoading}
                    fallback={
                      <button
                        type="button"
                        class={styles.reviewGenerateButton}
                        disabled={!hasFileRows() || busy('commit')}
                        onClick={() => props.onGenerateCommitMessage?.()}
                      >
                        Generate
                      </button>
                    }
                  >
                    <button
                      type="button"
                      class={styles.reviewGenerateButton}
                      onClick={() => props.onCancelGenerateCommitMessage?.()}
                    >
                      Cancel
                    </button>
                  </Show>
                </div>
                <Show when={props.commitMessageError}>
                  <div class={styles.reviewInlineError}>{props.commitMessageError}</div>
                </Show>
                <Show when={!stagedCount() && hasUnstagedChanges()}>
                  <div class={styles.reviewInlineHint}>
                    <Icon name="info" size={12} />
                    <span>Commit will stage current changes first.</span>
                  </div>
                </Show>
                <div class={styles.reviewShipActions}>
                  <button
                    type="button"
                    class={styles.reviewActionButtonPrimary}
                    disabled={!canCommit()}
                    onClick={() => props.onCommit?.(commitMessage())}
                  >
                    {props.actionBusyKey === 'commit' ? 'Committing…' : 'Commit'}
                  </button>
                  <button
                    type="button"
                    class={styles.reviewActionButton}
                    disabled={!canCommit()}
                    onClick={() => props.onCommitPush?.(commitMessage())}
                  >
                    {props.actionBusyKey === 'push' ? 'Pushing…' : 'Commit & Push'}
                  </button>
                  <button
                    type="button"
                    class={styles.reviewActionButton}
                    disabled={!canCommit() || (!canCreatePr() && !existingPrUrl())}
                    title={createPrTitle()}
                    onClick={() => props.onCommitPushCreatePr?.(commitMessage())}
                  >
                    {props.actionBusyKey === 'pr' ? 'Creating…' : 'Commit, Push & PR'}
                  </button>
                </div>
                <div class={styles.reviewShipSecondaryActions}>
                  <button
                    type="button"
                    class={styles.reviewActionButton}
                    disabled={busy('pr') || (!canCreatePr() && !existingPrUrl())}
                    title={createPrTitle()}
                    onClick={() => props.onCreatePr?.()}
                  >
                    <Icon name="git-pull-request" size={13} />
                    <span>{existingPrUrl() ? 'Open PR' : 'Create PR from existing commits'}</span>
                  </button>
                  <button
                    type="button"
                    class={styles.reviewActionButton}
                    onClick={() => props.onAskHermes?.()}
                  >
                    <Icon name="sparkles" size={13} />
                    <span>Ask Hermes</span>
                  </button>
                </div>
              </div>
            </Show>
          </Show>
        </Show>
      </Show>
    </div>
  );
};
