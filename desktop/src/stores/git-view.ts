import { createSignal } from 'solid-js';
import type { GitDiffResult, ReviewFilesResult } from '@/types/index.js';
import { getGateway } from './context.js';

const [workspaceSessionId, setWorkspaceSessionId] = createSignal<string | null>(null);
const [workspacePath, setWorkspacePathSignal] = createSignal<string | null>(null);
const [diffData, setDiffData] = createSignal<GitDiffResult | null>(null);
const [diffLoading, setDiffLoading] = createSignal(false);
const [diffError, setDiffError] = createSignal<string | null>(null);
const [activeFileIndex, setActiveFileIndex] = createSignal(0);
const [reviewData, setReviewData] = createSignal<ReviewFilesResult | null>(null);
const [reviewLoading, setReviewLoading] = createSignal(false);
const [reviewError, setReviewError] = createSignal<string | null>(null);
const [selectedReviewPath, setSelectedReviewPath] = createSignal<string | null>(null);
const [actionBusyKey, setActionBusyKey] = createSignal<string | null>(null);
const [commitMessage, setCommitMessage] = createSignal('');
const [commitMessageLoading, setCommitMessageLoading] = createSignal(false);
const [commitMessageError, setCommitMessageError] = createSignal<string | null>(null);
let requestSeq = 0;
let reviewSeq = 0;
let reviewDiffSeq = 0;
let commitMessageSeq = 0;

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

async function fetchReview(): Promise<void> {
  const wd = workspacePath();
  const sid = workspaceSessionId();
  const seq = ++reviewSeq;
  if (!wd || !sid) {
    setReviewData(null);
    setReviewError('Select a workspace first');
    setDiffData(null);
    return;
  }

  setReviewLoading(true);
  setReviewError(null);
  try {
    const gateway = getGateway();
    if (!gateway) throw new Error('Gateway is not initialized');
    const result = await gateway.review.files(sid);
    if (seq !== reviewSeq) return;
    setReviewData(result);
    const existing = selectedReviewPath();
    const nextPath = existing && result.files.some((file) => file.path === existing)
      ? existing
      : result.files[0]?.path ?? null;
    setSelectedReviewPath(nextPath);
    if (nextPath) {
      await fetchReviewDiff(nextPath);
    } else {
      setDiffData(null);
      setDiffError(null);
      setActiveFileIndex(0);
    }
  } catch (e) {
    if (seq !== reviewSeq) return;
    setReviewError(errorMessage(e, 'Failed to fetch review state'));
  } finally {
    if (seq === reviewSeq) setReviewLoading(false);
  }
}

async function fetchReviewDiff(path: string): Promise<void> {
  const sid = workspaceSessionId();
  const seq = ++reviewDiffSeq;
  if (!sid) return;
  setDiffLoading(true);
  setDiffError(null);
  try {
    const gateway = getGateway();
    if (!gateway) throw new Error('Gateway is not initialized');
    const file = reviewData()?.files.find((item) => item.path === path);
    const staged = Boolean(file?.staged && !file.unstaged && !file.untracked);
    const result = await gateway.review.diff(sid, { path, staged });
    if (seq !== reviewDiffSeq) return;
    setDiffData(result);
    setActiveFileIndex(0);
  } catch (e) {
    if (seq !== reviewDiffSeq) return;
    setDiffError(errorMessage(e, 'Failed to fetch diff'));
  } finally {
    if (seq === reviewDiffSeq) setDiffLoading(false);
  }
}

async function selectReviewFile(path: string): Promise<void> {
  setSelectedReviewPath(path);
  await fetchReviewDiff(path);
}

async function runReviewAction(key: string, action: () => Promise<void>): Promise<void> {
  setActionBusyKey(key);
  setReviewError(null);
  try {
    await action();
    await fetchReview();
  } catch (e) {
    setReviewError(errorMessage(e, 'Review action failed'));
  } finally {
    setActionBusyKey(null);
  }
}

async function stagePath(path: string): Promise<void> {
  const sid = workspaceSessionId();
  if (!sid) return;
  await runReviewAction(`stage:${path}`, async () => {
    const gateway = getGateway();
    if (!gateway) throw new Error('Gateway is not initialized');
    await gateway.review.stage(sid, [path]);
  });
}

async function unstagePath(path: string): Promise<void> {
  const sid = workspaceSessionId();
  if (!sid) return;
  await runReviewAction(`unstage:${path}`, async () => {
    const gateway = getGateway();
    if (!gateway) throw new Error('Gateway is not initialized');
    await gateway.review.unstage(sid, [path]);
  });
}

async function revertPath(path: string): Promise<void> {
  const sid = workspaceSessionId();
  if (!sid) return;
  await runReviewAction(`revert:${path}`, async () => {
    const gateway = getGateway();
    if (!gateway) throw new Error('Gateway is not initialized');
    await gateway.review.revert(sid, [path]);
  });
}

async function commitReview(message: string): Promise<void> {
  const sid = workspaceSessionId();
  const trimmed = message.trim();
  if (!sid || !trimmed) return;
  await runReviewAction('commit', async () => {
    const gateway = getGateway();
    if (!gateway) throw new Error('Gateway is not initialized');
    await gateway.review.commit(sid, trimmed);
    setCommitMessage('');
  });
}

async function pushReview(): Promise<void> {
  const sid = workspaceSessionId();
  if (!sid) return;
  await runReviewAction('push', async () => {
    const gateway = getGateway();
    if (!gateway) throw new Error('Gateway is not initialized');
    await gateway.review.push(sid);
  });
}

async function createPullRequest(): Promise<void> {
  const sid = workspaceSessionId();
  if (!sid) return;
  await runReviewAction('pr', async () => {
    const gateway = getGateway();
    if (!gateway) throw new Error('Gateway is not initialized');
    await gateway.review.createPr(sid);
  });
}

async function generateCommitMessage(avoid?: string): Promise<void> {
  const sid = workspaceSessionId();
  const seq = ++commitMessageSeq;
  if (!sid) return;
  setCommitMessageLoading(true);
  setCommitMessageError(null);
  try {
    const gateway = getGateway();
    if (!gateway) throw new Error('Gateway is not initialized');
    const result = await gateway.review.generateCommitMessage(sid, avoid);
    if (seq !== commitMessageSeq) return;
    if (result.status === 'generated' && result.message) {
      setCommitMessage(result.message);
    } else {
      setCommitMessageError(result.detail ?? 'Commit message generation unavailable');
    }
  } catch (e) {
    if (seq !== commitMessageSeq) return;
    setCommitMessageError(errorMessage(e, 'Commit message generation failed'));
  } finally {
    if (seq === commitMessageSeq) setCommitMessageLoading(false);
  }
}

function cancelCommitMessageGeneration(): void {
  commitMessageSeq += 1;
  setCommitMessageLoading(false);
}

function setWorkspacePath(path: string | null): void {
  setWorkspace(null, path);
}

function setWorkspace(sessionId: string | null, path: string | null): void {
  if (workspaceSessionId() === sessionId && workspacePath() === path) return;
  requestSeq += 1;
  reviewSeq += 1;
  reviewDiffSeq += 1;
  commitMessageSeq += 1;
  setWorkspaceSessionId(sessionId);
  setWorkspacePathSignal(path);
  setDiffData(null);
  setDiffError(null);
  setDiffLoading(false);
  setActiveFileIndex(0);
  setReviewData(null);
  setReviewError(null);
  setReviewLoading(false);
  setSelectedReviewPath(null);
  setActionBusyKey(null);
  setCommitMessage('');
  setCommitMessageError(null);
  setCommitMessageLoading(false);
}

function errorMessage(error: unknown, fallback: string): string {
  if (typeof error === 'string') return error;
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

export const gitViewStore = {
  workspacePath,
  workspaceSessionId,
  diffData,
  diffLoading,
  diffError,
  activeFileIndex,
  reviewData,
  reviewLoading,
  reviewError,
  selectedReviewPath,
  actionBusyKey,
  commitMessage,
  commitMessageLoading,
  commitMessageError,
  setWorkspace,
  setWorkspacePath,
  fetchDiff,
  fetchReview,
  selectReviewFile,
  stagePath,
  unstagePath,
  revertPath,
  commitReview,
  pushReview,
  createPullRequest,
  setCommitMessage,
  generateCommitMessage,
  cancelCommitMessageGeneration,
  selectDiffFile: setActiveFileIndex,
};
