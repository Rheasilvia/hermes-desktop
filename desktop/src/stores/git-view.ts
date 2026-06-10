import { createSignal } from 'solid-js';
import type { GitDiffResult } from '@/types/index.js';
import { getGateway } from './context.js';

const [workspaceSessionId, setWorkspaceSessionId] = createSignal<string | null>(null);
const [workspacePath, setWorkspacePathSignal] = createSignal<string | null>(null);
const [diffData, setDiffData] = createSignal<GitDiffResult | null>(null);
const [diffLoading, setDiffLoading] = createSignal(false);
const [diffError, setDiffError] = createSignal<string | null>(null);
const [activeFileIndex, setActiveFileIndex] = createSignal(0);
let requestSeq = 0;

async function fetchDiff(): Promise<void> {
  const wd = workspacePath();
  const sid = workspaceSessionId();
  const seq = ++requestSeq;
  if (!wd || !sid) {
    setDiffData(null);
    setDiffError('Select a workspace first');
    return;
  }

  setDiffLoading(true);
  setDiffError(null);
  try {
    const gateway = getGateway();
    if (!gateway) throw new Error('Gateway is not initialized');
    const result = await gateway.git.diff(sid);
    if (seq !== requestSeq) return;
    setDiffData(result);
    setActiveFileIndex(0);
  } catch (e) {
    if (seq !== requestSeq) return;
    setDiffError(typeof e === 'string' ? e : (e as Error).message ?? 'Failed to fetch diff');
  } finally {
    if (seq === requestSeq) setDiffLoading(false);
  }
}

function setWorkspacePath(path: string | null): void {
  setWorkspace(null, path);
}

function setWorkspace(sessionId: string | null, path: string | null): void {
  if (workspaceSessionId() === sessionId && workspacePath() === path) return;
  requestSeq += 1;
  setWorkspaceSessionId(sessionId);
  setWorkspacePathSignal(path);
  setDiffData(null);
  setDiffError(null);
  setDiffLoading(false);
  setActiveFileIndex(0);
}

export const gitViewStore = {
  workspacePath,
  workspaceSessionId,
  diffData,
  diffLoading,
  diffError,
  activeFileIndex,
  setWorkspace,
  setWorkspacePath,
  fetchDiff,
  selectDiffFile: setActiveFileIndex,
};
