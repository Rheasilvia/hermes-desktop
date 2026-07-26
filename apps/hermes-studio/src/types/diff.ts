/**
 * Git diff types — matches Rust GitDiffResult serialization.
 * Used by the diff panel to render structured git diff output.
 */

export type LineKind = 'context' | 'addition' | 'deletion';

export interface DiffLine {
  kind: LineKind;
  old_lineno: number | null;
  new_lineno: number | null;
  content: string;
}

export interface DiffHunk {
  header: string;
  old_start: number;
  old_count: number;
  new_start: number;
  new_count: number;
  lines: DiffLine[];
}

export type FileStatus = 'added' | 'modified' | 'deleted' | 'renamed';

export interface DiffFile {
  path: string;
  old_path: string | null;
  status: FileStatus;
  hunks: DiffHunk[];
}

export interface DiffSummary {
  files_changed: number;
  insertions: number;
  deletions: number;
}

export interface GitDiffResult {
  files: DiffFile[];
  summary: DiffSummary;
  working_dir: string;
}
