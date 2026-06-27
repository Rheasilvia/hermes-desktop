import type { FileStatus, GitDiffResult } from './diff.js';

export interface ReviewFile {
  path: string;
  old_path: string | null;
  status: FileStatus;
  staged: boolean;
  unstaged: boolean;
  untracked: boolean;
  insertions: number;
  deletions: number;
}

export interface ReviewSummary {
  files_changed: number;
  insertions: number;
  deletions: number;
  staged_count: number;
  unstaged_count: number;
  untracked_count: number;
}

export interface ReviewFilesResult {
  files: ReviewFile[];
  summary: ReviewSummary;
  working_dir: string;
  branch: string;
}

export interface ReviewCommitMessageResult {
  status: 'generated' | 'unavailable' | 'failed';
  message: string | null;
  detail?: string | null;
}

export interface ReviewShipInfoResult {
  current_branch: string;
  default_branch: string | null;
  pr_url: string | null;
  gh_available: boolean;
  can_create_pr: boolean;
}

export interface ReviewOkResult {
  ok: boolean;
  detail?: string | null;
}

export interface ReviewPrResult {
  ok: boolean;
  url?: string | null;
  detail?: string | null;
}

export type ReviewDiffResult = GitDiffResult;
