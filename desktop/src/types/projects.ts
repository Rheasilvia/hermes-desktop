export interface ProjectEntry {
  path: string;
  name: string;
  last_opened_at?: number | null;
}

export interface ProjectListResult {
  projects: ProjectEntry[];
  active_path?: string | null;
}

export interface WorktreeEntry {
  path: string;
  branch?: string | null;
  bare: boolean;
  detached: boolean;
}

export interface WorktreeListResult {
  worktrees: WorktreeEntry[];
}

export interface BranchListResult {
  current: string;
  branches: string[];
}
