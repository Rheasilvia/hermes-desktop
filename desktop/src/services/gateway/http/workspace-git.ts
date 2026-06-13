import type { HttpClient } from '@/services/api/http-client.js';
import type {
  GatewayAdapter,
  GitBranchInfo,
  GitDiffResult,
  WorkspaceChildrenResult,
  WorkspaceFileResult,
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
