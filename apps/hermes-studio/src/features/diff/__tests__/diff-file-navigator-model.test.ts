import { describe, expect, it } from 'vitest';
import type { DiffFile, FileStatus, LineKind } from '@/types/diff.js';
import {
  buildDiffFileRows,
  filterDiffFileRows,
} from '../diff-file-navigator-model.js';

const makeFile = (
  path: string,
  status: FileStatus,
  kinds: LineKind[],
  oldPath: string | null = null,
): DiffFile => ({
  path,
  old_path: oldPath,
  status,
  hunks: [
    {
      header: '@@ -1,3 +1,3 @@',
      old_start: 1,
      old_count: kinds.length,
      new_start: 1,
      new_count: kinds.length,
      lines: kinds.map((kind, index) => ({
        kind,
        old_lineno: kind === 'addition' ? null : index + 1,
        new_lineno: kind === 'deletion' ? null : index + 1,
        content: `${path} line ${index}`,
      })),
    },
  ],
});

describe('diff file navigator model', () => {
  it('builds stable rows with path parts, status, and change counts', () => {
    const rows = buildDiffFileRows([
      makeFile('src/components/Button.tsx', 'modified', ['context', 'addition', 'addition', 'deletion']),
      makeFile('README.md', 'added', ['addition']),
    ]);

    expect(rows[0]).toMatchObject({
      id: 'src/components/Button.tsx:0',
      index: 0,
      path: 'src/components/Button.tsx',
      basename: 'Button.tsx',
      dirname: 'src/components',
      status: 'modified',
      insertions: 2,
      deletions: 1,
    });
    expect(rows[1]).toMatchObject({
      index: 1,
      basename: 'README.md',
      dirname: '',
      status: 'added',
      insertions: 1,
      deletions: 0,
    });
  });

  it('filters by full path, basename, old path, and original status without changing source indexes', () => {
    const rows = buildDiffFileRows([
      makeFile('src/components/Button.tsx', 'modified', ['addition']),
      makeFile('docs/guide.md', 'added', ['addition']),
      makeFile('src/legacy/OldName.ts', 'renamed', ['context'], 'src/legacy/NewName.ts'),
    ]);

    expect(filterDiffFileRows(rows, 'button', 'all').map((row) => row.index)).toEqual([0]);
    expect(filterDiffFileRows(rows, 'src/legacy/newname', 'all').map((row) => row.index)).toEqual([2]);
    expect(filterDiffFileRows(rows, '', 'added').map((row) => row.index)).toEqual([1]);
    expect(filterDiffFileRows(rows, 'src', 'modified').map((row) => row.index)).toEqual([0]);
  });
});
