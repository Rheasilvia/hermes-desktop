import { describe, expect, it } from 'vitest';
import type { DiffFile } from '@/types/diff.js';
import {
  DIFF_FILE_HEADER_HEIGHT,
  DIFF_HUNK_HEADER_HEIGHT,
  DIFF_LINE_HEIGHT,
  flattenDiffFile,
  virtualizeFixedRows,
  virtualizeDiffRows,
} from '../virtual-diff.js';

const makeFile = (lineCount: number): DiffFile => ({
  path: 'src/example.ts',
  old_path: null,
  status: 'modified',
  hunks: [
    {
      header: '@@ -1,3 +1,3 @@',
      old_start: 1,
      old_count: lineCount,
      new_start: 1,
      new_count: lineCount,
      lines: Array.from({ length: lineCount }, (_, index) => ({
        kind: index % 2 === 0 ? 'context' : 'addition',
        old_lineno: index % 2 === 0 ? index + 1 : null,
        new_lineno: index + 1,
        content: `line ${index}`,
      })),
    },
  ],
});

describe('virtual diff model', () => {
  it('flattens a diff file into stable viewport rows', () => {
    const model = flattenDiffFile(makeFile(3), 2);

    expect(model.rows.map((row) => row.kind)).toEqual([
      'file-header',
      'hunk-header',
      'line',
      'line',
      'line',
    ]);
    expect(model.rows[0]).toMatchObject({
      id: 'src/example.ts:file-2',
      kind: 'file-header',
      top: 0,
      height: DIFF_FILE_HEADER_HEIGHT,
    });
    expect(model.rows[1]).toMatchObject({
      id: 'src/example.ts:hunk-0',
      top: DIFF_FILE_HEADER_HEIGHT,
      height: DIFF_HUNK_HEADER_HEIGHT,
    });
    expect(model.rows[2]).toMatchObject({
      id: 'src/example.ts:hunk-0-line-0',
      top: DIFF_FILE_HEADER_HEIGHT + DIFF_HUNK_HEADER_HEIGHT,
      height: DIFF_LINE_HEIGHT,
    });
    expect(model.totalHeight).toBe(DIFF_FILE_HEADER_HEIGHT + DIFF_HUNK_HEADER_HEIGHT + (3 * DIFF_LINE_HEIGHT));
    expect(model.maxContentChars).toBeGreaterThanOrEqual('src/example.ts'.length);
  });

  it('returns only the visible row range plus overscan', () => {
    const model = flattenDiffFile(makeFile(1000));
    const range = virtualizeDiffRows(model, 4000, 400, 4);

    expect(range.rows.length).toBeLessThan(40);
    expect(range.startIndex).toBeGreaterThan(0);
    expect(range.endIndex).toBeLessThan(model.rows.length);
    expect(range.beforeHeight).toBe(model.rows[range.startIndex].top);

    const lastVisible = range.rows[range.rows.length - 1];
    expect(range.afterHeight).toBe(model.totalHeight - lastVisible.top - lastVisible.height);
  });

  it('keeps the first row mounted near the top of the viewport', () => {
    const model = flattenDiffFile(makeFile(100));
    const range = virtualizeDiffRows(model, 0, 60, 2);

    expect(range.startIndex).toBe(0);
    expect(range.beforeHeight).toBe(0);
    expect(range.rows[0].kind).toBe('file-header');
  });

  it('virtualizes fixed-height file navigator rows with overscan', () => {
    const rows = Array.from({ length: 100 }, (_, index) => `file-${index}`);
    const range = virtualizeFixedRows(rows, 320, 160, 32, 2);

    expect(range.startIndex).toBe(8);
    expect(range.endIndex).toBe(17);
    expect(range.rows).toEqual(rows.slice(8, 17));
    expect(range.beforeHeight).toBe(256);
    expect(range.afterHeight).toBe(2656);
    expect(range.totalHeight).toBe(3200);
  });
});
