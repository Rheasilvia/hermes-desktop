import type { DiffFile, FileStatus } from '@/types/diff.js';

export type DiffFileStatusFilter = 'all' | FileStatus;

export interface DiffFileNavigatorRow {
  id: string;
  index: number;
  path: string;
  basename: string;
  dirname: string;
  status: FileStatus;
  insertions: number;
  deletions: number;
  searchText: string;
}

const splitPath = (path: string) => {
  const segments = path.split('/').filter(Boolean);
  if (segments.length === 0) {
    return { basename: path, dirname: '' };
  }

  const basename = segments[segments.length - 1] ?? path;
  const dirname = segments.slice(0, -1).join('/');
  return { basename, dirname };
};

const countChanges = (file: DiffFile) => {
  let insertions = 0;
  let deletions = 0;

  for (const hunk of file.hunks) {
    for (const line of hunk.lines) {
      if (line.kind === 'addition') {
        insertions += 1;
      } else if (line.kind === 'deletion') {
        deletions += 1;
      }
    }
  }

  return { insertions, deletions };
};

export function buildDiffFileRows(files: DiffFile[]): DiffFileNavigatorRow[] {
  return files.map((file, index) => {
    const { basename, dirname } = splitPath(file.path);
    const { insertions, deletions } = countChanges(file);
    const searchText = `${file.path} ${basename} ${dirname} ${file.old_path ?? ''}`.toLowerCase();

    return {
      id: `${file.path}:${index}`,
      index,
      path: file.path,
      basename,
      dirname,
      status: file.status,
      insertions,
      deletions,
      searchText,
    };
  });
}

export function filterDiffFileRows(
  rows: DiffFileNavigatorRow[],
  query: string,
  statusFilter: DiffFileStatusFilter,
): DiffFileNavigatorRow[] {
  const normalizedQuery = query.trim().toLowerCase();

  return rows.filter((row) => {
    if (statusFilter !== 'all' && row.status !== statusFilter) return false;
    if (!normalizedQuery) return true;
    return row.searchText.includes(normalizedQuery);
  });
}
