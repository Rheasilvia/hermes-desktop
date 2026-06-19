import type { Component, JSX } from 'solid-js';
import { For, Match, Show, Switch, createEffect, createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import type { DiffFile, LineKind } from '@/types/diff.js';
import {
  DIFF_LINE_HEIGHT,
  flattenDiffFile,
  virtualizeDiffRows,
  type VirtualDiffLineRow,
  type VirtualDiffRow,
} from './virtual-diff.js';
import styles from './DiffPanel.module.css';

interface DiffContentProps {
  files: DiffFile[];
  activeIndex?: number;
  onSelectFile?: (index: number) => void;
}

const DEFAULT_VIEWPORT_HEIGHT = 600;
const DIFF_GUTTER_WIDTH = 132;
const OVERSCAN_ROWS = 10;

const STATUS_LABEL: Record<string, string> = {
  added: 'Added',
  modified: 'Modified',
  deleted: 'Deleted',
  renamed: 'Renamed',
};

const LINE_KIND_CLASS: Record<LineKind, string> = {
  context: styles.diffLineContext,
  addition: styles.diffLineAddition,
  deletion: styles.diffLineDeletion,
};

const LINE_PREFIX: Record<LineKind, string> = {
  context: ' ',
  addition: '+',
  deletion: '-',
};

interface VirtualDiffRowViewProps {
  row: VirtualDiffRow;
}

const rowStyle = (row: VirtualDiffRow): JSX.CSSProperties => ({
  height: `${row.height}px`,
  transform: `translateY(${row.top}px)`,
});

const VirtualDiffLine: Component<{ row: VirtualDiffLineRow }> = (props) => {
  const line = () => props.row.line;
  const kindClass = () => LINE_KIND_CLASS[line().kind] ?? styles.diffLineContext;
  const prefix = () => LINE_PREFIX[line().kind] ?? ' ';

  return (
    <div
      class={`${styles.diffVirtualRow} ${styles.diffLine} ${kindClass()}`}
      style={rowStyle(props.row)}
      data-testid="diff-virtual-line"
      data-row-id={props.row.id}
      data-kind={line().kind}
    >
      <span class={styles.diffLineNumber}>
        {line().old_lineno != null ? line().old_lineno : ''}
      </span>
      <span class={styles.diffLineNumber}>
        {line().new_lineno != null ? line().new_lineno : ''}
      </span>
      <span class={styles.diffLinePrefix}>{prefix()}</span>
      <span class={styles.diffLineContent}>{line().content}</span>
    </div>
  );
};

const VirtualDiffRowView: Component<VirtualDiffRowViewProps> = (props) => (
  <Switch>
    <Match when={props.row.kind === 'file-header'}>
      <div
        class={`${styles.diffVirtualRow} ${styles.diffFileHeaderRow}`}
        style={rowStyle(props.row)}
        data-testid="diff-virtual-file-header"
      >
        <span class={styles.diffFileName}>{props.row.kind === 'file-header' ? props.row.path : ''}</span>
        <span class={`${styles.diffFileStatus} ${props.row.kind === 'file-header' ? styles[`fileStatus${STATUS_LABEL[props.row.status] ?? 'Modified'}`] : ''}`}>
          {props.row.kind === 'file-header' ? STATUS_LABEL[props.row.status] ?? 'Modified' : ''}
        </span>
      </div>
    </Match>
    <Match when={props.row.kind === 'hunk-header'}>
      <div
        class={`${styles.diffVirtualRow} ${styles.diffHunkHeader}`}
        style={rowStyle(props.row)}
        data-testid="diff-virtual-hunk-header"
      >
        {props.row.kind === 'hunk-header' ? props.row.header : ''}
      </div>
    </Match>
    <Match when={props.row.kind === 'line'}>
      <VirtualDiffLine row={props.row as VirtualDiffLineRow} />
    </Match>
    <Match when={props.row.kind === 'truncated'}>
      <div
        class={`${styles.diffVirtualRow} ${styles.diffTruncated}`}
        style={rowStyle(props.row)}
        data-testid="diff-virtual-truncated"
      >
        {props.row.kind === 'truncated' ? props.row.message : ''}
      </div>
    </Match>
  </Switch>
);

export const DiffContent: Component<DiffContentProps> = (props) => {
  let viewportRef: HTMLDivElement | undefined;
  let resizeObserver: ResizeObserver | null = null;
  let measuredViewportHeight = 0;
  const [scrollTop, setScrollTop] = createSignal(0);
  const [viewportHeight, setViewportHeight] = createSignal(DEFAULT_VIEWPORT_HEIGHT);
  const activeIndex = createMemo(() => {
    const count = props.files.length;
    if (count === 0) return 0;
    const requestedIndex = props.activeIndex ?? 0;
    return Math.min(Math.max(requestedIndex, 0), count - 1);
  });
  const activeFile = createMemo(() => props.files[activeIndex()] ?? null);
  const flattenedFile = createMemo(() => {
    const file = activeFile();
    return file ? flattenDiffFile(file, activeIndex()) : { rows: [], totalHeight: 0, maxContentChars: 24 };
  });
  const virtualRows = createMemo(() =>
    virtualizeDiffRows(flattenedFile(), scrollTop(), viewportHeight(), OVERSCAN_ROWS),
  );
  const surfaceMinWidth = createMemo(() =>
    `max(100%, calc(${flattenedFile().maxContentChars}ch + ${DIFF_GUTTER_WIDTH}px))`,
  );

  const setMeasuredViewportHeight = (height: number) => {
    const nextHeight = Math.max(0, Math.ceil(height));
    if (nextHeight === measuredViewportHeight) return;
    measuredViewportHeight = nextHeight;
    setViewportHeight(nextHeight || DEFAULT_VIEWPORT_HEIGHT);
  };

  const handleScroll: JSX.EventHandler<HTMLDivElement, Event> = (event) => {
    setScrollTop(event.currentTarget.scrollTop);
  };

  createEffect(() => {
    flattenedFile();
    setScrollTop(0);
    if (viewportRef) viewportRef.scrollTop = 0;
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
    <div class={styles.diffContent}>
      <div
        ref={(el) => { viewportRef = el; }}
        class={styles.diffVirtualViewport}
        onScroll={handleScroll}
        data-testid="diff-virtual-viewport"
      >
        <div
          class={styles.diffVirtualSurface}
          style={{
            height: `${flattenedFile().totalHeight}px`,
            'min-width': surfaceMinWidth(),
            '--diff-line-height': `${DIFF_LINE_HEIGHT}px`,
          }}
          data-testid="diff-virtual-surface"
        >
          <Show when={activeFile()}>
            <For each={virtualRows().rows}>
              {(row) => <VirtualDiffRowView row={row} />}
            </For>
          </Show>
        </div>
      </div>
    </div>
  );
};
