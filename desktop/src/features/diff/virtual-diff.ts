import type { DiffFile, DiffLine, FileStatus } from '@/types/diff.js';

export const DIFF_FILE_HEADER_HEIGHT = 32;
export const DIFF_HUNK_HEADER_HEIGHT = 22;
export const DIFF_LINE_HEIGHT = 20;
export const DIFF_TRUNCATED_HEIGHT = 40;

export type VirtualDiffRowKind = 'file-header' | 'hunk-header' | 'line' | 'truncated';

interface VirtualDiffRowBase {
  id: string;
  kind: VirtualDiffRowKind;
  top: number;
  height: number;
}

export interface VirtualDiffFileHeaderRow extends VirtualDiffRowBase {
  kind: 'file-header';
  fileIndex: number;
  path: string;
  oldPath: string | null;
  status: FileStatus;
}

export interface VirtualDiffHunkHeaderRow extends VirtualDiffRowBase {
  kind: 'hunk-header';
  hunkIndex: number;
  header: string;
}

export interface VirtualDiffLineRow extends VirtualDiffRowBase {
  kind: 'line';
  hunkIndex: number;
  lineIndex: number;
  line: DiffLine;
}

export interface VirtualDiffTruncatedRow extends VirtualDiffRowBase {
  kind: 'truncated';
  message: string;
}

export type VirtualDiffRow =
  | VirtualDiffFileHeaderRow
  | VirtualDiffHunkHeaderRow
  | VirtualDiffLineRow
  | VirtualDiffTruncatedRow;

export interface FlattenedDiffFile {
  rows: VirtualDiffRow[];
  totalHeight: number;
  maxContentChars: number;
}

export interface VirtualDiffRange {
  rows: VirtualDiffRow[];
  startIndex: number;
  endIndex: number;
  beforeHeight: number;
  afterHeight: number;
}

export interface FixedVirtualRange<T> {
  rows: T[];
  startIndex: number;
  endIndex: number;
  beforeHeight: number;
  afterHeight: number;
  totalHeight: number;
}

const MIN_CONTENT_CHARS = 24;

const advanceTop = (currentTop: number, height: number) => currentTop + height;

const makeRowId = (file: DiffFile, suffix: string) => `${file.path}:${suffix}`;

export function flattenDiffFile(file: DiffFile, fileIndex = 0): FlattenedDiffFile {
  const rows: VirtualDiffRow[] = [];
  let top = 0;
  let maxContentChars = Math.max(MIN_CONTENT_CHARS, file.path.length, file.old_path?.length ?? 0);

  rows.push({
    id: makeRowId(file, `file-${fileIndex}`),
    kind: 'file-header',
    fileIndex,
    path: file.path,
    oldPath: file.old_path,
    status: file.status,
    top,
    height: DIFF_FILE_HEADER_HEIGHT,
  });
  top = advanceTop(top, DIFF_FILE_HEADER_HEIGHT);

  file.hunks.forEach((hunk, hunkIndex) => {
    maxContentChars = Math.max(maxContentChars, hunk.header.length);
    rows.push({
      id: makeRowId(file, `hunk-${hunkIndex}`),
      kind: 'hunk-header',
      hunkIndex,
      header: hunk.header,
      top,
      height: DIFF_HUNK_HEADER_HEIGHT,
    });
    top = advanceTop(top, DIFF_HUNK_HEADER_HEIGHT);

    hunk.lines.forEach((line, lineIndex) => {
      maxContentChars = Math.max(maxContentChars, line.content.length);
      rows.push({
        id: makeRowId(file, `hunk-${hunkIndex}-line-${lineIndex}`),
        kind: 'line',
        hunkIndex,
        lineIndex,
        line,
        top,
        height: DIFF_LINE_HEIGHT,
      });
      top = advanceTop(top, DIFF_LINE_HEIGHT);
    });
  });

  return {
    rows,
    totalHeight: top,
    maxContentChars,
  };
}

function firstRowIntersecting(rows: VirtualDiffRow[], scrollTop: number): number {
  let low = 0;
  let high = rows.length - 1;
  let result = rows.length;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const row = rows[mid];
    if (row.top + row.height > scrollTop) {
      result = mid;
      high = mid - 1;
    } else {
      low = mid + 1;
    }
  }

  return result;
}

function firstRowAfter(rows: VirtualDiffRow[], viewportBottom: number): number {
  let low = 0;
  let high = rows.length - 1;
  let result = rows.length;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const row = rows[mid];
    if (row.top >= viewportBottom) {
      result = mid;
      high = mid - 1;
    } else {
      low = mid + 1;
    }
  }

  return result;
}

export function virtualizeDiffRows(
  model: FlattenedDiffFile,
  scrollTop: number,
  viewportHeight: number,
  overscanRows = 8,
): VirtualDiffRange {
  const { rows, totalHeight } = model;
  if (rows.length === 0) {
    return { rows: [], startIndex: 0, endIndex: 0, beforeHeight: 0, afterHeight: 0 };
  }

  const safeScrollTop = Math.max(0, scrollTop);
  const safeViewportHeight = Math.max(0, viewportHeight);
  const viewportBottom = safeScrollTop + safeViewportHeight;
  const firstVisible = firstRowIntersecting(rows, safeScrollTop);
  const firstAfter = firstRowAfter(rows, viewportBottom);
  const startIndex = Math.max(0, firstVisible - overscanRows);
  const endIndex = Math.min(rows.length, Math.max(firstAfter, firstVisible + 1) + overscanRows);
  const visibleRows = rows.slice(startIndex, endIndex);
  const beforeHeight = visibleRows[0]?.top ?? 0;
  const lastRow = visibleRows[visibleRows.length - 1];
  const afterHeight = lastRow ? Math.max(0, totalHeight - lastRow.top - lastRow.height) : 0;

  return {
    rows: visibleRows,
    startIndex,
    endIndex,
    beforeHeight,
    afterHeight,
  };
}

export function virtualizeFixedRows<T>(
  rows: T[],
  scrollTop: number,
  viewportHeight: number,
  rowHeight: number,
  overscanRows = 8,
): FixedVirtualRange<T> {
  const safeRowHeight = Math.max(1, rowHeight);
  const safeScrollTop = Math.max(0, scrollTop);
  const safeViewportHeight = Math.max(0, viewportHeight);
  const totalHeight = rows.length * safeRowHeight;

  if (rows.length === 0) {
    return {
      rows: [],
      startIndex: 0,
      endIndex: 0,
      beforeHeight: 0,
      afterHeight: 0,
      totalHeight: 0,
    };
  }

  const firstVisible = Math.floor(safeScrollTop / safeRowHeight);
  const visibleCount = Math.max(1, Math.ceil(safeViewportHeight / safeRowHeight));
  const startIndex = Math.max(0, firstVisible - overscanRows);
  const endIndex = Math.min(rows.length, firstVisible + visibleCount + overscanRows);
  const visibleRows = rows.slice(startIndex, endIndex);
  const beforeHeight = startIndex * safeRowHeight;
  const afterHeight = Math.max(0, totalHeight - (endIndex * safeRowHeight));

  return {
    rows: visibleRows,
    startIndex,
    endIndex,
    beforeHeight,
    afterHeight,
    totalHeight,
  };
}
