import type { Component, JSX } from 'solid-js';
import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import type { FileStatus } from '@/types/diff.js';
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
}

interface StatusFilterOption {
  value: DiffFileStatusFilter;
  label: string;
  shortLabel: string;
}

const FILE_NAV_ROW_HEIGHT = 32;
const FILE_NAV_OVERSCAN_ROWS = 8;
const DEFAULT_FILE_NAV_VIEWPORT_HEIGHT = 320;

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

const pluralizeFiles = (count: number) => `${count} ${count === 1 ? 'file' : 'files'}`;

export const DiffFileNavigator: Component<DiffFileNavigatorProps> = (props) => {
  let viewportRef: HTMLDivElement | undefined;
  let resizeObserver: ResizeObserver | null = null;
  let measuredViewportHeight = 0;
  const [query, setQuery] = createSignal('');
  const [statusFilter, setStatusFilter] = createSignal<DiffFileStatusFilter>('all');
  const [scrollTop, setScrollTop] = createSignal(0);
  const [viewportHeight, setViewportHeight] = createSignal(DEFAULT_FILE_NAV_VIEWPORT_HEIGHT);
  const [focusedRowIndex, setFocusedRowIndex] = createSignal(0);
  const filteredRows = createMemo(() =>
    filterDiffFileRows(props.rows, query(), statusFilter()),
  );
  const virtualRows = createMemo(() =>
    virtualizeFixedRows(filteredRows(), scrollTop(), viewportHeight(), FILE_NAV_ROW_HEIGHT, FILE_NAV_OVERSCAN_ROWS),
  );
  const selectedFilteredIndex = createMemo(() => {
    const index = filteredRows().findIndex((row) => row.index === props.activeIndex);
    return index >= 0 ? index : 0;
  });

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
    const rows = filteredRows();
    if (rows.length === 0) {
      setFocusedRowIndex(0);
      return;
    }
    const nextIndex = Math.max(0, Math.min(index, rows.length - 1));
    setFocusedRowIndex(nextIndex);

    if (!viewportRef) return;
    const rowTop = nextIndex * FILE_NAV_ROW_HEIGHT;
    const rowBottom = rowTop + FILE_NAV_ROW_HEIGHT;
    const viewportTop = viewportRef.scrollTop;
    const viewportBottom = viewportTop + viewportRef.clientHeight;
    if (rowTop < viewportTop) {
      viewportRef.scrollTop = rowTop;
      setScrollTop(rowTop);
    } else if (rowBottom > viewportBottom) {
      const nextScrollTop = rowBottom - viewportRef.clientHeight;
      viewportRef.scrollTop = nextScrollTop;
      setScrollTop(nextScrollTop);
    }
  };

  const selectRow = (row: DiffFileNavigatorRow) => {
    props.onSelect(row.index);
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
      focusRow(filteredRows().length - 1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const row = filteredRows()[focusedRowIndex()];
      if (row) selectRow(row);
    }
  };

  createEffect(() => {
    filteredRows();
    const nextIndex = selectedFilteredIndex();
    const nextScrollTop = nextIndex * FILE_NAV_ROW_HEIGHT;
    setFocusedRowIndex(nextIndex);
    setScrollTop(nextScrollTop);
    if (viewportRef) viewportRef.scrollTop = nextScrollTop;
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
          <div class={styles.diffFileNavigatorTitle}>Files</div>
          <div class={styles.diffFileNavigatorCount}>{pluralizeFiles(filteredRows().length)}</div>
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
        role="listbox"
        aria-label={props.ariaLabel}
        tabIndex={0}
        onKeyDown={handleKeyDown}
        onScroll={handleScroll}
        data-testid="diff-file-list"
      >
        <Show
          when={filteredRows().length > 0}
          fallback={<div class={styles.diffFileEmptyState}>No files match.</div>}
        >
          <div
            class={styles.diffFileListSurface}
            style={{ height: `${virtualRows().totalHeight}px` }}
          >
            <For each={virtualRows().rows}>
              {(row, index) => {
                const absoluteIndex = () => virtualRows().startIndex + index();
                const selected = () => row.index === props.activeIndex;
                const focused = () => focusedRowIndex() === absoluteIndex();
                return (
                  <button
                    type="button"
                    role="option"
                    tabIndex={-1}
                    aria-selected={selected()}
                    class={styles.diffFileRow}
                    classList={{
                      [styles.diffFileRowSelected]: selected(),
                      [styles.diffFileRowFocused]: focused(),
                    }}
                    style={{
                      height: `${FILE_NAV_ROW_HEIGHT}px`,
                      transform: `translateY(${absoluteIndex() * FILE_NAV_ROW_HEIGHT}px)`,
                    }}
                    title={row.path}
                    onClick={() => selectRow(row)}
                    data-testid="diff-file-row"
                    data-file-index={row.index}
                  >
                    <span class={`${styles.statusDot} ${STATUS_DOT_CLASS[row.status]}`} />
                    <span class={styles.diffFileRowText}>
                      <span class={styles.diffFileRowName}>{row.basename}</span>
                      <Show when={row.dirname}>
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
                  </button>
                );
              }}
            </For>
          </div>
        </Show>
      </div>
    </div>
  );
};
