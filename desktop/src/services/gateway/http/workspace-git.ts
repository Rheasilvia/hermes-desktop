import type { HttpClient } from '@/services/api/http-client.js';
import type {
  GatewayAdapter,
  BranchListResult,
  GitBranchInfo,
  GitDiffResult,
  ProjectEntry,
  ProjectListResult,
  ReviewCommitMessageResult,
  ReviewFilesResult,
  ReviewOkResult,
  ReviewPrResult,
  WorkspaceChildrenResult,
  WorkspaceFileResult,
  WorktreeListResult,
} from '../types.js';
import { API_PREFIX } from './shared.js';

export function makeWorkspaceGateway(http: HttpClient): GatewayAdapter['workspace'] {
  return {
    children: async (sessionId: string, path: string): Promise<WorkspaceChildrenResult> =>
      http.get<WorkspaceChildrenResult>(
        `${API_PREFIX}/sessions/${encodeURIComponent(sessionId)}/workspace/children?path=${encodeURIComponent(path)}`,
      ),
    readFile: async (sessionId: string, path: string): Promise<WorkspaceFileResult> =>
      http.get<WorkspaceFileResult>(
        `${API_PREFIX}/sessions/${encodeURIComponent(sessionId)}/workspace/file?path=${encodeURIComponent(path)}`,
      ),
    writeFile: async (sessionId, input) =>
      http.put<WorkspaceFileResult>(
        `${API_PREFIX}/sessions/${encodeURIComponent(sessionId)}/workspace/file`,
        {
          path: input.path,
          content: input.content,
          expected_mtime: input.expectedMtime ?? null,
          expected_size: input.expectedSize ?? null,
        },
      ),
    reveal: async (sessionId: string, path: string): Promise<void> => {
      await http.post(
        `${API_PREFIX}/sessions/${encodeURIComponent(sessionId)}/workspace/reveal`,
        { path },
      );
    },
  };
}

export function makeGitGateway(http: HttpClient): GatewayAdapter['git'] {
  return {
    diff: async (sessionId: string): Promise<GitDiffResult> =>
      http.get<GitDiffResult>(
        `${API_PREFIX}/sessions/${encodeURIComponent(sessionId)}/git/diff`,
      ),
    branches: async (sessionId: string): Promise<GitBranchInfo> =>
      http.get<GitBranchInfo>(
        `${API_PREFIX}/sessions/${encodeURIComponent(sessionId)}/git/branches`,
      ),
    checkout: async (sessionId: string, branch: string): Promise<void> => {
      await http.post(
        `${API_PREFIX}/sessions/${encodeURIComponent(sessionId)}/git/checkout`,
        { branch },
      );
    },
  };
}

export function makeReviewGateway(http: HttpClient): GatewayAdapter['review'] {
  const reviewUrl = (sessionId: string, path: string) =>
    `${API_PREFIX}/sessions/${encodeURIComponent(sessionId)}/review/${path}`;

  return {
    files: async (sessionId) =>
      http.get<ReviewFilesResult>(reviewUrl(sessionId, 'files')),
    diff: async (sessionId, input = {}) =>
      http.post<GitDiffResult>(reviewUrl(sessionId, 'diff'), {
        path: input.path ?? null,
        staged: input.staged ?? false,
      }),
    stage: async (sessionId, paths) =>
      http.post<ReviewOkResult>(reviewUrl(sessionId, 'stage'), { paths }),
    unstage: async (sessionId, paths) =>
      http.post<ReviewOkResult>(reviewUrl(sessionId, 'unstage'), { paths }),
    revert: async (sessionId, paths) =>
      http.post<ReviewOkResult>(reviewUrl(sessionId, 'revert'), { paths }),
    commit: async (sessionId, message) =>
      http.post<ReviewOkResult>(reviewUrl(sessionId, 'commit'), { message }),
    push: async (sessionId) =>
      http.post<ReviewOkResult>(reviewUrl(sessionId, 'push'), {}),
    createPr: async (sessionId) =>
      http.post<ReviewPrResult>(reviewUrl(sessionId, 'pr'), {}),
    generateCommitMessage: async (sessionId, avoid) =>
      http.post<ReviewCommitMessageResult>(
        reviewUrl(sessionId, 'commit-message'),
        { avoid: avoid ?? null },
      ),
  };
}

export function makeProjectGateway(http: HttpClient): GatewayAdapter['projects'] {
  return {
    list: async () =>
      http.get<ProjectListResult>(`${API_PREFIX}/projects`),
    upsert: async (path, name) =>
      http.post<ProjectEntry>(`${API_PREFIX}/projects`, { path, name: name ?? null }),
    setActive: async (path) =>
      http.put<ProjectListResult>(`${API_PREFIX}/projects/active`, { path }),
    worktrees: async (repoPath) =>
      http.get<WorktreeListResult>(
        `${API_PREFIX}/projects/worktrees?repo_path=${encodeURIComponent(repoPath)}`,
      ),
    addWorktree: async (input) =>
      http.post<ReviewOkResult>(`${API_PREFIX}/projects/worktrees/add`, {
        repo_path: input.repoPath,
        path: input.path,
        branch: input.branch,
        create_branch: input.createBranch ?? false,
      }),
    removeWorktree: async (input) =>
      http.post<ReviewOkResult>(`${API_PREFIX}/projects/worktrees/remove`, {
        repo_path: input.repoPath,
        path: input.path,
      }),
    branches: async (repoPath) =>
      http.get<BranchListResult>(
        `${API_PREFIX}/projects/branches?repo_path=${encodeURIComponent(repoPath)}`,
      ),
    switchBranch: async (input) =>
      http.post<ReviewOkResult>(`${API_PREFIX}/projects/branches/switch`, {
        path: input.path,
        branch: input.branch,
      }),
  };
}
