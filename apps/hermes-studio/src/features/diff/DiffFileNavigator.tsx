import type { Component, JSX } from 'solid-js';
import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import type { FileStatus } from '@/types/diff.js';
import type { ReviewFile } from '@/types/review.js';
import { Icon } from '@/ui/atoms/Icon.js';
import { virtualizeFixedRows } from './virtual-diff.js';
import type {
  DiffFileNavigatorRow,
  DiffFileStatusFilter,
} from './diff-file-navigator-model.js';
import { filterDiffFileRows } from './diff-file-navigator-model.js';
import styles from './DiffPanel.module.css';

interface DiffFileNavigatorProps {
  rows: DiffFileNavigatorRow[];
  activeIndex: number;
  ariaLabel: string;
  onSelect: (index: number) => void;
  onClose?: () => void;
  reviewFiles?: ReviewFile[];
  actionBusyKey?: string | null;
  actionInFlight?: boolean;
  onStageFile?: (path: string) => void;
  onUnstageFile?: (path: string) => void;
  onRevertFile?: (path: string) => void;
}

interface StatusFilterOption {
  value: DiffFileStatusFilter;
  label: string;
  shortLabel: string;
}

const FILE_NAV_ROW_HEIGHT = 32;
const FILE_NAV_OVERSCAN_ROWS = 8;
const DEFAULT_FILE_NAV_VIEWPORT_HEIGHT = 320;
const TREE_INDENT_STEP_PX = 16;
const TREE_INDENT_MAX_DEPTH = 4;

const STATUS_FILTERS: StatusFilterOption[] = [
  { value: 'all', label: 'All', shortLabel: 'All' },
  { value: 'modified', label: 'Modified', shortLabel: 'Mod' },
  { value: 'added', label: 'Added', shortLabel: 'Add' },
  { value: 'deleted', label: 'Deleted', shortLabel: 'Del' },
  { value: 'renamed', label: 'Renamed', shortLabel: 'Ren' },
];

const STATUS_DOT_CLASS: Record<FileStatus, string> = {
  added: styles.statusAdded,
  modified: styles.statusModified,
  deleted: styles.statusDeleted,
  renamed: styles.statusRenamed,
};

const STATUS_LABEL: Record<FileStatus, string> = {
  added: 'added',
  modified: 'modified',
  deleted: 'deleted',
  renamed: 'renamed',
};

const pluralizeFiles = (count: number) => `${count} ${count === 1 ? 'file' : 'files'}`;

const treeIndentOffset = (depth: number) => `${Math.min(depth, TREE_INDENT_MAX_DEPTH) * TREE_INDENT_STEP_PX}px`;

type NavigatorViewMode = 'tree' | 'list';

type NavigatorDisplayRow =
  | { kind: 'directory'; id: string; path: string; name: string; depth: number }
  | { kind: 'file'; id: string; row: DiffFileNavigatorRow; depth: number };

const directorySegments = (dirname: string) => dirname.split('/').filter(Boolean);

function buildNavigatorDisplayRows(
  rows: DiffFileNavigatorRow[],
  viewMode: NavigatorViewMode,
  collapsedDirs: ReadonlySet<string>,
): NavigatorDisplayRow[] {
  if (viewMode === 'list') {
    return rows.map((row) => ({ kind: 'file', id: row.id, row, depth: 0 }));
  }

  const displayRows: NavigatorDisplayRow[] = [];
  const seenDirs = new Set<string>();
  for (const row of rows) {
    const dirs = directorySegments(row.dirname);
    let current = '';
    let hiddenByCollapsedParent = false;
    for (let index = 0; index < dirs.length; index += 1) {
      current = current ? `${current}/${dirs[index]}` : dirs[index]!;
      if (!seenDirs.has(current)) {
        seenDirs.add(current);
        displayRows.push({
          kind: 'directory',
          id: `dir:${current}`,
          path: current,
          name: dirs[index]!,
          depth: index,
        });
      }
      if (collapsedDirs.has(current)) {
        hiddenByCollapsedParent = true;
        break;
      }
    }
    if (!hiddenByCollapsedParent) {
      displayRows.push({ kind: 'file', id: row.id, row, depth: dirs.length });
    }
  }
  return displayRows;
}

export const DiffFileNavigator: Component<DiffFileNavigatorProps> = (props) => {
  let viewportRef: HTMLDivElement | undefined;
  let resizeObserver: ResizeObserver | null = null;
  let measuredViewportHeight = 0;
  const [query, setQuery] = createSignal('');
  const [statusFilter, setStatusFilter] = createSignal<DiffFileStatusFilter>('all');
  const [viewMode, setViewMode] = createSignal<NavigatorViewMode>('tree');
  const [collapsedDirs, setCollapsedDirs] = createSignal<ReadonlySet<string>>(new Set());
  const [scrollTop, setScrollTop] = createSignal(0);
  const [viewportHeight, setViewportHeight] = createSignal(DEFAULT_FILE_NAV_VIEWPORT_HEIGHT);
  const [focusedRowIndex, setFocusedRowIndex] = createSignal(0);
  const filteredRows = createMemo(() =>
    filterDiffFileRows(props.rows, query(), statusFilter()),
  );
  const displayRows = createMemo(() =>
    buildNavigatorDisplayRows(filteredRows(), viewMode(), collapsedDirs()),
  );
  const virtualRows = createMemo(() =>
    virtualizeFixedRows(displayRows(), scrollTop(), viewportHeight(), FILE_NAV_ROW_HEIGHT, FILE_NAV_OVERSCAN_ROWS),
  );
  const selectedDisplayIndex = createMemo(() => {
    const index = displayRows().findIndex((row) => row.kind === 'file' && row.row.index === props.activeIndex);
    return index >= 0 ? index : 0;
  });
  const viewportClientHeight = () => viewportRef?.clientHeight || viewportHeight();
  const maxScrollTop = (rowCount = displayRows().length) =>
    Math.max(0, rowCount * FILE_NAV_ROW_HEIGHT - viewportClientHeight());
  const clampScrollTop = (nextScrollTop: number, rowCount = displayRows().length) =>
    Math.max(0, Math.min(nextScrollTop, maxScrollTop(rowCount)));

  const syncScrollTop = (nextScrollTop: number, rowCount = displayRows().length) => {
    const clampedScrollTop = clampScrollTop(nextScrollTop, rowCount);
    if (viewportRef && viewportRef.scrollTop !== clampedScrollTop) {
      viewportRef.scrollTop = clampedScrollTop;
    }
    setScrollTop(clampedScrollTop);
  };

  const setMeasuredViewportHeight = (height: number) => {
    const nextHeight = Math.max(0, Math.ceil(height));
    if (nextHeight === measuredViewportHeight) return;
    measuredViewportHeight = nextHeight;
    setViewportHeight(nextHeight || DEFAULT_FILE_NAV_VIEWPORT_HEIGHT);
  };

  const handleScroll: JSX.EventHandler<HTMLDivElement, Event> = (event) => {
    setScrollTop(event.currentTarget.scrollTop);
  };

  const focusRow = (index: number) => {
    const rows = displayRows();
    if (rows.length === 0) {
      setFocusedRowIndex(0);
      return;
    }
    const nextIndex = Math.max(0, Math.min(index, rows.length - 1));
    setFocusedRowIndex(nextIndex);

    const rowTop = nextIndex * FILE_NAV_ROW_HEIGHT;
    const rowBottom = rowTop + FILE_NAV_ROW_HEIGHT;
    const viewportTop = viewportRef?.scrollTop ?? scrollTop();
    const viewportBottom = viewportTop + viewportClientHeight();
    if (rowTop < viewportTop) {
      syncScrollTop(rowTop, rows.length);
    } else if (rowBottom > viewportBottom) {
      syncScrollTop(rowBottom - viewportClientHeight(), rows.length);
    } else {
      syncScrollTop(viewportTop, rows.length);
    }
  };

  const reviewFileByPath = createMemo(() => {
    const entries = props.reviewFiles ?? [];
    return new Map(entries.map((file) => [file.path, file]));
  });
  const containerRole = () => viewMode() === 'tree' ? 'tree' : 'listbox';
  const rowRole = () => viewMode() === 'tree' ? 'treeitem' : 'option';
  const fileAriaLabel = (row: DiffFileNavigatorRow) => {
    const churn = [
      row.insertions > 0 ? `+${row.insertions}` : null,
      row.deletions > 0 ? `-${row.deletions}` : null,
    ].filter(Boolean).join(' ');
    return `${row.path}, ${STATUS_LABEL[row.status]}${churn ? `, ${churn}` : ''}`;
  };
  const busy = (key: string) => props.actionInFlight === true || props.actionBusyKey === key;
  const toggleDirectory = (path: string) => {
    setCollapsedDirs((current) => {
      const next = new Set(current);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  const selectRow = (row: NavigatorDisplayRow) => {
    if (row.kind === 'directory') {
      toggleDirectory(row.path);
      return;
    }
    props.onSelect(row.row.index);
  };

  const handleKeyDown: JSX.EventHandler<HTMLDivElement, KeyboardEvent> = (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      focusRow(focusedRowIndex() + 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      focusRow(focusedRowIndex() - 1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      focusRow(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      focusRow(displayRows().length - 1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const row = displayRows()[focusedRowIndex()];
      if (row) selectRow(row);
    }
  };

  createEffect(() => {
    displayRows();
    const nextIndex = selectedDisplayIndex();
    setFocusedRowIndex(nextIndex);
    focusRow(nextIndex);
  });

  onMount(() => {
    if (!viewportRef) return;
    setMeasuredViewportHeight(viewportRef.clientHeight);
    if (typeof ResizeObserver === 'undefined') return;

    resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      setMeasuredViewportHeight(entry.contentRect.height);
    });
    resizeObserver.observe(viewportRef);
  });

  onCleanup(() => {
    resizeObserver?.disconnect();
    resizeObserver = null;
  });

  return (
    <div class={styles.diffFileNavigator}>
      <div class={styles.diffFileNavigatorHeader}>
        <div class={styles.diffFileNavigatorTitleRow}>
          <div class={styles.diffFileNavigatorTitleMeta}>
            <div class={styles.diffFileNavigatorTitle}>Files</div>
            <div class={styles.diffFileNavigatorCount}>{pluralizeFiles(filteredRows().length)}</div>
          </div>
          <div class={styles.diffFileViewToggle} role="group" aria-label="Changed files view">
            <button
              type="button"
              class={styles.diffFileViewButton}
              classList={{ [styles.diffFileViewButtonActive]: viewMode() === 'tree' }}
              aria-pressed={viewMode() === 'tree'}
              onClick={() => setViewMode('tree')}
            >
              Tree
            </button>
            <button
              type="button"
              class={styles.diffFileViewButton}
              classList={{ [styles.diffFileViewButtonActive]: viewMode() === 'list' }}
              aria-pressed={viewMode() === 'list'}
              onClick={() => setViewMode('list')}
            >
              List
            </button>
          </div>
          <Show when={props.onClose}>
            <button
              type="button"
              class={styles.diffFileNavigatorClose}
              aria-label="Close changed files"
              title="Close changed files"
              onClick={() => props.onClose?.()}
            >
              <Icon name="x" size={13} strokeWidth={2} />
            </button>
          </Show>
        </div>
        <label class={styles.diffFileSearch} aria-label="Search changed files">
          <Icon name="search" size={13} strokeWidth={1.7} class={styles.diffFileSearchIcon} />
          <input
            class={styles.diffFileSearchInput}
            type="search"
            value={query()}
            placeholder="Search files"
            onInput={(event) => setQuery(event.currentTarget.value)}
          />
        </label>
        <div class={styles.diffFileFilterBar} role="group" aria-label="Filter changed files">
          <For each={STATUS_FILTERS}>
            {(filter) => (
              <button
                type="button"
                class={styles.diffFileFilterButton}
                classList={{ [styles.diffFileFilterButtonActive]: statusFilter() === filter.value }}
                aria-pressed={statusFilter() === filter.value}
                aria-label={`Show ${filter.label} files`}
                title={filter.label}
                onClick={() => setStatusFilter(filter.value)}
              >
                {filter.shortLabel}
              </button>
            )}
          </For>
        </div>
      </div>
      <div
        ref={(el) => { viewportRef = el; }}
        class={styles.diffFileList}
        role={containerRole()}
        aria-label={props.ariaLabel}
        tabIndex={0}
        onKeyDown={handleKeyDown}
        onScroll={handleScroll}
        data-testid="diff-file-list"
      >
        <Show
          when={displayRows().length > 0}
          fallback={<div class={styles.diffFileEmptyState}>No files match.</div>}
        >
          <div
            class={styles.diffFileListSurface}
            style={{ height: `${virtualRows().totalHeight}px` }}
          >
            <For each={virtualRows().rows}>
              {(displayRow, index) => {
                const absoluteIndex = () => virtualRows().startIndex + index();
                const selected = () => displayRow.kind === 'file' && displayRow.row.index === props.activeIndex;
                const focused = () => focusedRowIndex() === absoluteIndex();
                const depth = () => displayRow.depth;
                if (displayRow.kind === 'directory') {
                  return (
                    <button
                      type="button"
                      role={rowRole()}
                      tabIndex={-1}
                      aria-selected={false}
                      aria-expanded={!collapsedDirs().has(displayRow.path)}
                      aria-level={displayRow.depth + 1}
                      aria-label={displayRow.path}
                      class={styles.diffFileDirRow}
                      classList={{
                        [styles.diffFileRowFocused]: focused(),
                        [styles.diffFileTreeRowNested]: viewMode() === 'tree' && depth() > 0,
                      }}
                      style={{
                        height: `${FILE_NAV_ROW_HEIGHT}px`,
                        transform: `translateY(${absoluteIndex() * FILE_NAV_ROW_HEIGHT}px)`,
                        '--file-depth': String(depth()),
                        '--file-depth-offset': treeIndentOffset(depth()),
                      } as JSX.CSSProperties}
                      onClick={() => selectRow(displayRow)}
                      data-testid="diff-file-dir-row"
                    >
                      <Icon
                        name="chevron-down"
                        size={13}
                        class={collapsedDirs().has(displayRow.path) ? styles.diffFileDirChevronCollapsed : styles.diffFileDirChevron}
                      />
                      <Icon name="folder" size={13} class={styles.diffFileDirIcon} />
                      <span class={styles.diffFileDirName}>{displayRow.name}</span>
                    </button>
                  );
                }

                const row = displayRow.row;
                const file = () => reviewFileByPath().get(row.path) ?? null;
                return (
                  <div
                    role={rowRole()}
                    aria-selected={selected()}
                    aria-level={viewMode() === 'tree' ? depth() + 1 : undefined}
                    aria-label={fileAriaLabel(row)}
                    class={styles.diffFileRow}
                    classList={{
                      [styles.diffFileRowSelected]: selected(),
                      [styles.diffFileRowFocused]: focused(),
                      [styles.diffFileTreeRowNested]: viewMode() === 'tree' && depth() > 0,
                    }}
                    style={{
                      height: `${FILE_NAV_ROW_HEIGHT}px`,
                      transform: `translateY(${absoluteIndex() * FILE_NAV_ROW_HEIGHT}px)`,
                      '--file-depth': String(depth()),
                      '--file-depth-offset': treeIndentOffset(depth()),
                    } as JSX.CSSProperties}
                    title={row.path}
                    onClick={() => selectRow(displayRow)}
                    data-testid="diff-file-row"
                    data-file-index={row.index}
                  >
                    <div
                      class={styles.diffFileRowSelect}
                      classList={{ [styles.diffFileRowSelectTree]: viewMode() === 'tree' }}
                      aria-hidden="true"
                    >
                      <Show when={viewMode() === 'tree'}>
                        <span class={styles.diffFileTreeFileSpacer} data-testid="diff-file-tree-spacer" />
                      </Show>
                      <span class={`${styles.statusDot} ${STATUS_DOT_CLASS[row.status]}`} />
                      <span class={styles.diffFileRowText}>
                        <span class={styles.diffFileRowName}>{row.basename}</span>
                        <Show when={viewMode() === 'list' && row.dirname}>
                          <span class={styles.diffFileRowDir}>{row.dirname}</span>
                        </Show>
                      </span>
                      <span class={styles.diffFileRowCounts}>
                        <Show when={row.insertions > 0}>
                          <span class={styles.diffFileRowInsertions}>+{row.insertions}</span>
                        </Show>
                        <Show when={row.deletions > 0}>
                          <span class={styles.diffFileRowDeletions}>-{row.deletions}</span>
                        </Show>
                      </span>
                    </div>
                    <Show when={file()}>
                      {(reviewFile) => (
                        <span class={styles.diffFileRowActions}>
                          <Show when={reviewFile().unstaged || reviewFile().untracked}>
                            <button
                              type="button"
                              class={styles.diffFileRowAction}
                              disabled={busy(`stage:${reviewFile().path}`)}
                              title={`Stage ${reviewFile().path}`}
                              aria-label={`Stage ${reviewFile().path}`}
                              onClick={(event) => {
                                event.stopPropagation();
                                props.onStageFile?.(reviewFile().path);
                              }}
                            >
                              <Icon name="plus" size={12} />
                            </button>
                          </Show>
                          <Show when={reviewFile().staged}>
                            <button
                              type="button"
                              class={styles.diffFileRowAction}
                              disabled={busy(`unstage:${reviewFile().path}`)}
                              title={`Unstage ${reviewFile().path}`}
                              aria-label={`Unstage ${reviewFile().path}`}
                              onClick={(event) => {
                                event.stopPropagation();
                                props.onUnstageFile?.(reviewFile().path);
                              }}
                            >
                              <Icon name="minus" size={12} />
                            </button>
                          </Show>
                          <Show when={reviewFile().unstaged || reviewFile().untracked}>
                            <button
                              type="button"
                              class={styles.diffFileRowActionDanger}
                              disabled={busy(`revert:${reviewFile().path}`)}
                              title={`Revert ${reviewFile().path}`}
                              aria-label={`Revert ${reviewFile().path}`}
                              onClick={(event) => {
                                event.stopPropagation();
                                if (window.confirm(`Revert changes in ${reviewFile().path}?`)) {
                                  props.onRevertFile?.(reviewFile().path);
                                }
                              }}
                            >
                              <Icon name="archive-restore" size={12} />
                            </button>
                          </Show>
                        </span>
                      )}
                    </Show>
                  </div>
                );
              }}
            </For>
          </div>
        </Show>
      </div>
    </div>
  );
};
