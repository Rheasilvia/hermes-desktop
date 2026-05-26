import { createSignal } from 'solid-js';
import { invoke } from '@tauri-apps/api/core';
import type { GitDiffResult } from '@/types/index.js';

const [workspacePath, setWorkspacePathSignal] = createSignal<string | null>(null);
const [diffData, setDiffData] = createSignal<GitDiffResult | null>(null);
const [diffLoading, setDiffLoading] = createSignal(false);
const [diffError, setDiffError] = createSignal<string | null>(null);
const [activeFileIndex, setActiveFileIndex] = createSignal(0);
let requestSeq = 0;

async function fetchDiff(): Promise<void> {
  const wd = workspacePath();
  const seq = ++requestSeq;
  if (!wd) {
    setDiffData(null);
    setDiffError('Select a workspace first');
    return;
  }

  setDiffLoading(true);
  setDiffError(null);
  try {
    const result = await invoke<GitDiffResult>('run_git_diff', { cwd: wd });
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
  if (workspacePath() === path) return;
  requestSeq += 1;
  setWorkspacePathSignal(path);
  setDiffData(null);
  setDiffError(null);
  setDiffLoading(false);
  setActiveFileIndex(0);
}

export const gitViewStore = {
  workspacePath,
  diffData,
  diffLoading,
  diffError,
  activeFileIndex,
  setWorkspacePath,
  fetchDiff,
  selectDiffFile: setActiveFileIndex,
};
