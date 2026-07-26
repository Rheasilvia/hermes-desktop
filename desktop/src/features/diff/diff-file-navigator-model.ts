import type { DiffFile, FileStatus } from '@/types/diff.js';
import type { ReviewFile } from '@/types/review.js';

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

export function buildReviewFileRows(files: ReviewFile[]): DiffFileNavigatorRow[] {
  return files.map((file, index) => {
    const { basename, dirname } = splitPath(file.path);
    const searchText = `${file.path} ${basename} ${dirname} ${file.old_path ?? ''}`.toLowerCase();

    return {
      id: `${file.path}:${index}`,
      index,
      path: file.path,
      basename,
      dirname,
      status: file.status,
      insertions: file.insertions,
      deletions: file.deletions,
      searchText,
    };
  });
}

export interface DiffChurnBar {
  /** Total churn (insertions + deletions) for the row. */
  total: number;
  /** Percentage of the ins/del split that is insertions (0–100). */
  addPct: number;
  /** Percentage of the ins/del split that is deletions (0–100). */
  delPct: number;
  /**
   * Fraction (0–1) of the fixed bar track this row should fill, scaled by the
   * row's churn relative to the largest churn in the change set. Falls back to
   * a full-width bar when no positive `maxChurn` is provided.
   */
  widthFraction: number;
}

/**
 * Derive the proportional churn bar segments for a single file row. The ins/del
 * split is always relative to the row's own churn; the overall bar width is
 * optionally scaled against the busiest file so a 200-line change reads as a
 * visibly longer bar than a 2-line one.
 */
export function churnBarSegments(
  insertions: number,
  deletions: number,
  maxChurn = 0,
): DiffChurnBar {
  const total = insertions + deletions;
  if (total <= 0) {
    return { total: 0, addPct: 0, delPct: 0, widthFraction: 0 };
  }
  const addPct = (insertions / total) * 100;
  const widthFraction = maxChurn > 0 ? Math.min(1, total / maxChurn) : 1;
  return { total, addPct, delPct: 100 - addPct, widthFraction };
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
