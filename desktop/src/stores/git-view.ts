import { createSignal } from 'solid-js';
import { createStore } from 'solid-js/store';
import type { GitDiffResult, ReviewFilesResult, ReviewShipInfoResult } from '@/types/index.js';
import {
  REVIEW_FILE_RAIL_DEFAULT_WIDTH,
  REVIEW_FILE_RAIL_MAX_WIDTH,
  REVIEW_FILE_RAIL_MIN_WIDTH,
} from '@/lib/review-split-layout.js';
import { invoke } from '@tauri-apps/api/core';
import { getGateway } from './context.js';
import { toastStore } from './toast.js';
import { composerInsertionStore } from './composer-insertions.js';

export type ReviewActionKind = 'stage' | 'unstage' | 'revert' | 'commit' | 'push' | 'pr';
export type ReviewActionStatus = 'success' | 'failed';

export interface ReviewActionLogEntry {
  id: number;
  kind: ReviewActionKind;
  status: ReviewActionStatus;
  /** Human-readable label, e.g. "Staged src/app.ts" or "Push failed: ...". */
  message: string;
  /** ms since epoch. */
  at: number;
}

let nextActionId = 1;

const [workspaceSessionId, setWorkspaceSessionId] = createSignal<string | null>(null);
const [workspacePath, setWorkspacePathSignal] = createSignal<string | null>(null);
const [diffData, setDiffData] = createSignal<GitDiffResult | null>(null);
const [diffLoading, setDiffLoading] = createSignal(false);
const [diffError, setDiffError] = createSignal<string | null>(null);
const [activeFileIndex, setActiveFileIndex] = createSignal(0);
const [reviewData, setReviewData] = createSignal<ReviewFilesResult | null>(null);
const [reviewLoading, setReviewLoading] = createSignal(false);
const [reviewError, setReviewError] = createSignal<string | null>(null);
// Stable machine-readable backend code behind `reviewError` (e.g.
// `MACOS_DEVELOPER_TOOLS_MISSING`), or null when the error has no code. The UI
// uses this to decide whether to show an action button (Install Command Line
// Tools) alongside the human-readable `reviewError()` text.
const [reviewErrorCode, setReviewErrorCode] = createSignal<string | null>(null);
const [selectedReviewPath, setSelectedReviewPath] = createSignal<string | null>(null);
const [actionBusyKey, setActionBusyKey] = createSignal<string | null>(null);
// Append-only log of review actions (stage/unstage/revert/commit/push/pr), each
// with a status. The Review panel renders this as a collapsible status panel:
// collapsed it just confirms the last result; expanded it shows the history with
// failed actions marked red. This replaces the old alert-style error banner.
const [actionLog, setActionLog] = createStore<ReviewActionLogEntry[]>([]);
// True while ANY review mutation is in flight; disables all mutation buttons
// to prevent overlapping actions racing the post-action refresh.
const [reviewActionInFlight, setReviewActionInFlight] = createSignal(false);
// Last PR url surfaced by the Review panel. Source/branch metadata lets
// ship-info clear a stale confirmed PR without erasing a just-created URL when
// gh needs a moment to report it back.
const [createdPrUrl, setCreatedPrUrlSignal] = createSignal<string | null>(null);
const [createdPrUrlSource, setCreatedPrUrlSource] = createSignal<'create' | 'ship-info' | null>(null);
const [createdPrBranch, setCreatedPrBranch] = createSignal<string | null>(null);
// Repository default branch (best-effort, via gh). Used to disable the PR
// button when the current branch is the default (gh pr create can't open a
// PR from main→main). null while unknown / resolving.
const [defaultBranch, setDefaultBranch] = createSignal<string | null>(null);
const [reviewShipInfo, setReviewShipInfo] = createSignal<ReviewShipInfoResult | null>(null);
const [commitMessage, setCommitMessage] = createSignal('');
const [commitMessageLoading, setCommitMessageLoading] = createSignal(false);
const [commitMessageError, setCommitMessageError] = createSignal<string | null>(null);
const [reviewFileRailWidth, setReviewFileRailWidthSignal] = createSignal(REVIEW_FILE_RAIL_DEFAULT_WIDTH);
let requestSeq = 0;
let reviewSeq = 0;
let reviewDiffSeq = 0;
let commitMessageSeq = 0;

const COMMIT_MESSAGE_DETAIL_MESSAGES: Record<string, string> = {
  NO_DIFF: 'No changes to summarize.',
  COMMIT_MESSAGE_PROVIDER_UNAVAILABLE: 'Commit message generation is unavailable.',
};

const hasReviewChanges = () => Boolean(reviewData()?.summary.files_changed);

function setReviewFileRailWidth(width: number): void {
  const safeWidth = Number.isFinite(width) ? width : REVIEW_FILE_RAIL_DEFAULT_WIDTH;
  setReviewFileRailWidthSignal(Math.round(
    Math.min(
      Math.max(safeWidth, REVIEW_FILE_RAIL_MIN_WIDTH),
      REVIEW_FILE_RAIL_MAX_WIDTH,
    ),
  ));
}

function resetReviewFileRailWidth(): void {
  setReviewFileRailWidthSignal(REVIEW_FILE_RAIL_DEFAULT_WIDTH);
}

const changedReviewPaths = () => reviewData()?.files.map((file) => file.path) ?? [];
const unstagedReviewPaths = () =>
  reviewData()?.files
    .filter((file) => file.unstaged || file.untracked)
    .map((file) => file.path) ?? [];

const commitMessageErrorLabel = () => {
  const raw = commitMessageError();
  if (!raw) return null;
  return COMMIT_MESSAGE_DETAIL_MESSAGES[raw] ?? raw;
};

function clearCreatedPrUrl(): void {
  setCreatedPrUrlSignal(null);
  setCreatedPrUrlSource(null);
  setCreatedPrBranch(null);
}

function setCreatedPrUrl(url: string | null): void {
  if (!url) {
    clearCreatedPrUrl();
    return;
  }
  setCreatedPrUrlSignal(url);
  setCreatedPrUrlSource('create');
  setCreatedPrBranch(reviewShipInfo()?.current_branch || currentBranch());
}

function cacheShipInfoPrUrl(url: string, branch: string): void {
  setCreatedPrUrlSignal(url);
  setCreatedPrUrlSource('ship-info');
  setCreatedPrBranch(branch || null);
}

function clearCreatedPrUrlIfBranchChanged(branch: string | null | undefined): void {
  const cachedBranch = createdPrBranch();
  if (branch && cachedBranch && branch !== cachedBranch) {
    clearCreatedPrUrl();
  }
}

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
    setReviewErrorCode(null);
    setDiffData(null);
    return;
  }

  setReviewLoading(true);
  setReviewError(null);
  setReviewErrorCode(null);
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
      setCommitMessageError(null);
    }
  } catch (e) {
    if (seq !== reviewSeq) return;
    applyReviewError(e, 'Failed to fetch review state');
  } finally {
    if (seq === reviewSeq) setReviewLoading(false);
  }
  void fetchReviewShipInfo();
}

// Current checked-out branch, from the loaded review data (ReviewFilesResult.branch).
const currentBranch = () => reviewData()?.branch ?? null;

// True when the current branch equals the repo default branch — gh pr create
// can't open a PR from main→main, so the PR button is gated off in that case.
const isOnDefaultBranch = () => {
  const current = reviewShipInfo()?.current_branch || currentBranch();
  const def = reviewShipInfo()?.default_branch ?? defaultBranch();
  return Boolean(current) && Boolean(def) && current === def;
};

async function fetchReviewShipInfo(): Promise<void> {
  const sid = workspaceSessionId();
  if (!sid) return;
  try {
    const gateway = getGateway();
    if (!gateway?.review?.shipInfo) {
      await fetchDefaultBranch();
      return;
    }
    const info = await gateway.review.shipInfo(sid);
    setReviewShipInfo(info);
    setDefaultBranch(info.default_branch ?? null);
    if (info.pr_url) {
      cacheShipInfoPrUrl(info.pr_url, info.current_branch);
    } else if (createdPrUrlSource() === 'ship-info') {
      clearCreatedPrUrl();
    } else {
      clearCreatedPrUrlIfBranchChanged(info.current_branch);
    }
  } catch {
    setReviewShipInfo(null);
    void fetchDefaultBranch();
  }
}

async function fetchDefaultBranch(): Promise<void> {
  const sid = workspaceSessionId();
  if (!sid) return;
  try {
    const gateway = getGateway();
    if (!gateway?.review?.defaultBranch) return;
    const branch = await gateway.review.defaultBranch(sid);
    setDefaultBranch(branch || null);
  } catch {
    setDefaultBranch(null);
  }
}

// Lightweight reconciliation after a single-file stage/unstage: re-fetches only
// the file list + summary (no diff re-pull), guarded against out-of-order
// responses by sharing the reviewSeq counter with fetchReview.
async function refreshReviewFiles(): Promise<void> {
  const sid = workspaceSessionId();
  const seq = ++reviewSeq;
  if (!sid) return;
  try {
    const gateway = getGateway();
    if (!gateway) return;
    const result = await gateway.review.files(sid);
    if (seq !== reviewSeq) return;
    setReviewData(result);
    clearCreatedPrUrlIfBranchChanged(result.branch);
    const existing = selectedReviewPath();
    const nextPath = existing && result.files.some((file) => file.path === existing)
      ? existing
      : result.files[0]?.path ?? null;
    setSelectedReviewPath(nextPath);
    if (!nextPath) {
      setDiffData(null);
      setDiffError(null);
      setActiveFileIndex(0);
      setCommitMessageError(null);
    }
  } catch {
    // Staging reconciliation is best-effort; the optimistic update already
    // reflects intent. A genuine failure will surface on the next full fetch.
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

// Human-readable label for an action kind, used in the status panel history.
function actionLabel(kind: ReviewActionKind, detail?: string): string {
  switch (kind) {
    case 'stage': return detail ? `Staged ${detail}` : 'Staged';
    case 'unstage': return detail ? `Unstaged ${detail}` : 'Unstaged';
    case 'revert': return detail ? `Reverted ${detail}` : 'Reverted';
    case 'commit': return detail ? `Committed: ${detail}` : 'Committed';
    case 'push': return 'Pushed';
    case 'pr': return 'Pull request created';
  }
}

function logAction(kind: ReviewActionKind, status: ReviewActionStatus, message: string): void {
  const entry: ReviewActionLogEntry = { id: nextActionId, kind, status, message, at: Date.now() };
  nextActionId += 1;
  // Keep the most recent 20 entries.
  setActionLog((prev) => [...prev.slice(-19), entry]);
}

// Runs a review mutation. Errors are recorded into the action log (rendered as
// a collapsible status panel), never as an alert banner and never hiding the
// diff. Returns the action result or null on failure.
async function runReviewAction<T>(
  key: string,
  kind: ReviewActionKind,
  action: () => Promise<T>,
  successMessage?: string,
  formatFailureMessage?: (message: string) => string,
): Promise<T | null> {
  setActionBusyKey(key);
  // Clear any stale full-panel error left over from a prior load failure.
  setReviewError(null);
  setReviewErrorCode(null);
  setDiffError(null);
  setReviewActionInFlight(true);
  try {
    const result = await action();
    logAction(kind, 'success', successMessage ?? actionLabel(kind));
    return result;
  } catch (e) {
    const { message } = resolveReviewError(e, 'Review action failed');
    logAction(kind, 'failed', formatFailureMessage ? formatFailureMessage(message) : message);
    return null;
  } finally {
    setActionBusyKey(null);
    setReviewActionInFlight(false);
  }
}

// Optimistically flip a file's staged/unstaged flags + summary counts for an
// immediate UI response, before the backend round-trip confirms it.
function optimisticStageToggle(path: string, staging: boolean): void {
  const current = reviewData();
  if (!current) return;
  const files = current.files.map((file) => {
    if (file.path !== path) return file;
    if (staging) {
      return { ...file, staged: true, unstaged: false, untracked: false };
    }
    return { ...file, staged: false, unstaged: file.untracked ? false : true };
  });
  setReviewData({ ...current, files });
}

async function stagePath(path: string): Promise<void> {
  const sid = workspaceSessionId();
  if (!sid) return;
  optimisticStageToggle(path, true);
  await runReviewAction(`stage:${path}`, 'stage', async () => {
    const gateway = getGateway();
    if (!gateway) throw new Error('Gateway is not initialized');
    return gateway.review.stage(sid, [path]);
  }, actionLabel('stage', path));
  // Reconcile with the authoritative file list in the background (no need to
  // re-fetch the current file's diff content — it didn't change).
  void refreshReviewFiles();
}

async function stageAllReviewChanges(): Promise<boolean> {
  const sid = workspaceSessionId();
  const paths = unstagedReviewPaths();
  if (!sid || paths.length === 0) return false;
  const ok = await runReviewAction('stage:all', 'stage', async () => {
    const gateway = getGateway();
    if (!gateway) throw new Error('Gateway is not initialized');
    return gateway.review.stage(sid, paths);
  }, `Staged ${paths.length} ${paths.length === 1 ? 'file' : 'files'}`);
  if (ok) {
    await fetchReview();
    return true;
  }
  return false;
}

async function unstagePath(path: string): Promise<void> {
  const sid = workspaceSessionId();
  if (!sid) return;
  optimisticStageToggle(path, false);
  await runReviewAction(`unstage:${path}`, 'unstage', async () => {
    const gateway = getGateway();
    if (!gateway) throw new Error('Gateway is not initialized');
    return gateway.review.unstage(sid, [path]);
  }, actionLabel('unstage', path));
  void refreshReviewFiles();
}

async function revertPath(path: string): Promise<void> {
  const sid = workspaceSessionId();
  if (!sid) return;
  const ok = await runReviewAction(`revert:${path}`, 'revert', async () => {
    const gateway = getGateway();
    if (!gateway) throw new Error('Gateway is not initialized');
    return gateway.review.revert(sid, [path]);
  }, actionLabel('revert', path));
  if (ok) toastStore.success(`Reverted ${path}`);
  // revert changes the working tree, so a full refresh is warranted.
  void fetchReview();
}

async function revertAllReviewChanges(): Promise<boolean> {
  const sid = workspaceSessionId();
  const paths = changedReviewPaths();
  if (!sid || paths.length === 0) return false;
  const ok = await runReviewAction('revert:all', 'revert', async () => {
    const gateway = getGateway();
    if (!gateway) throw new Error('Gateway is not initialized');
    return gateway.review.revert(sid, paths);
  }, `Reverted ${paths.length} ${paths.length === 1 ? 'file' : 'files'}`);
  if (ok) {
    toastStore.success('Reverted changes');
    await fetchReview();
    return true;
  }
  return false;
}

async function ensureStagedForCommit(): Promise<boolean> {
  const summary = reviewData()?.summary;
  if (summary?.staged_count) return true;
  return stageAllReviewChanges();
}

async function commitThenMaybePush(input: { message: string; push?: boolean }): Promise<boolean> {
  const sid = workspaceSessionId();
  const trimmed = input.message.trim();
  if (!sid || !trimmed) return false;
  const staged = await ensureStagedForCommit();
  if (!staged) return false;
  const ok = await runReviewAction('commit', 'commit', async () => {
    const gateway = getGateway();
    if (!gateway) throw new Error('Gateway is not initialized');
    const res = await gateway.review.commit(sid, trimmed);
    setCommitMessage('');
    return res;
  }, actionLabel('commit', trimmed));
  if (ok) {
    toastStore.success('Committed');
    await fetchReview();
    if (!input.push) return true;
    const pushed = await runReviewAction('push', 'push', async () => {
      const gateway = getGateway();
      if (!gateway) throw new Error('Gateway is not initialized');
      return gateway.review.push(sid);
    }, 'Committed and pushed', (message) => `Committed, but push failed: ${message}`);
    if (pushed) {
      toastStore.success('Pushed');
      void fetchReviewShipInfo();
    }
    return Boolean(pushed);
  }
  return false;
}

async function commitReview(message: string): Promise<void> {
  await commitThenMaybePush({ message, push: false });
}

async function pushReview(): Promise<void> {
  const sid = workspaceSessionId();
  if (!sid) return;
  const ok = await runReviewAction('push', 'push', async () => {
    const gateway = getGateway();
    if (!gateway) throw new Error('Gateway is not initialized');
    return gateway.review.push(sid);
  });
  if (ok) {
    toastStore.success('Pushed');
    void fetchReviewShipInfo();
  }
  // No working-tree change; skip the refetch.
}

async function createPullRequest(): Promise<void> {
  const sid = workspaceSessionId();
  if (!sid) return;
  const existingUrl = reviewShipInfo()?.pr_url ?? createdPrUrl();
  if (existingUrl) {
    await invoke('open_external', { url: existingUrl });
    return;
  }
  const result = await runReviewAction('pr', 'pr', async () => {
    const gateway = getGateway();
    if (!gateway) throw new Error('Gateway is not initialized');
    return gateway.review.createPr(sid);
  });
  if (!result) return;
  const url = result.url ?? null;
  setCreatedPrUrl(url);
  toastStore.success(
    'Pull request created',
    url ? { label: 'Open', onClick: () => void invoke('open_external', { url }) } : undefined,
  );
  void fetchReviewShipInfo();
}

async function commitPushAndCreatePullRequest(message: string): Promise<void> {
  const shipped = await commitThenMaybePush({ message, push: true });
  if (!shipped) return;
  await createPullRequest();
}

function submitReviewPromptToComposer(): void {
  const sid = workspaceSessionId();
  if (!sid) return;
  const files = reviewData()?.files ?? [];
  const fileList = files
    .slice(0, 20)
    .map((file) => `- ${file.path} (+${file.insertions} -${file.deletions})`)
    .join('\n');
  const suffix = files.length > 20 ? `\n- ...and ${files.length - 20} more files` : '';
  const prompt = [
    'Review the current git changes in this workspace and help ship them.',
    'Use real git commands where appropriate: inspect the diff, stage files intentionally, create a concise commit, push the branch, and open a PR if the branch is ready.',
    fileList ? `Changed files:\n${fileList}${suffix}` : 'The Review panel is currently clean; verify the working tree before doing anything.',
  ].join('\n\n');
  composerInsertionStore.submit(sid, prompt);
  logAction('pr', 'success', 'Asked Hermes to review and ship');
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
  setReviewErrorCode(null);
  setReviewLoading(false);
  setSelectedReviewPath(null);
  setActionBusyKey(null);
  setActionLog([]);
  setReviewActionInFlight(false);
  clearCreatedPrUrl();
  setDefaultBranch(null);
  setReviewShipInfo(null);
  setCommitMessage('');
  setCommitMessageError(null);
  setCommitMessageLoading(false);
}

// Maps backend error codes (HTTP `detail`) to human-readable messages shown in
// the review panel. Raw codes like MACOS_DEVELOPER_TOOLS_MISSING are confusing
// on their own; this turns them into actionable guidance. Unknown messages and
// non-code strings pass through unchanged.
const REVIEW_ERROR_CODE_MESSAGES: Record<string, string> = {
  MACOS_DEVELOPER_TOOLS_MISSING:
    'git needs the macOS Command Line Tools, which are missing or misconfigured. Install them with the button below, then press Retry.',
  NOT_GIT_REPOSITORY: 'This workspace is not a git repository.',
  WORKSPACE_UNAVAILABLE: 'No workspace selected for this session.',
  SANDBOX_UNAVAILABLE: 'The sandboxed command runner is unavailable.',
  PR_UNAVAILABLE: 'The GitHub CLI (gh) is not installed or not available on PATH. Install it from https://cli.github.com and run `gh auth login`.',
  PR_CREATE_TIMEOUT: 'Creating the pull request timed out. Check your network and that the remote is reachable, then retry.',
  NO_STAGED_CHANGES: 'Nothing is staged. Stage a file before committing.',
  COMMIT_MESSAGE_REQUIRED: 'Enter a commit message before committing.',
};

// Backend codes that the renderer can offer a one-click fix for.
const ACTIONABLE_REVIEW_ERROR_CODES = new Set(['MACOS_DEVELOPER_TOOLS_MISSING']);

function resolveReviewError(error: unknown, fallback: string): { code: string | null; message: string } {
  const raw = typeof error === 'string'
    ? error
    : error instanceof Error
      ? error.message
      : '';
  if (!raw) return { code: null, message: fallback };
  if (raw in REVIEW_ERROR_CODE_MESSAGES) {
    return { code: raw, message: REVIEW_ERROR_CODE_MESSAGES[raw] };
  }
  // PR_SAME_BRANCH:<branch> — current branch equals the repo default; gh pr
  // create can't open a PR from main→main.
  const sameBranchMatch = raw.match(/^PR_SAME_BRANCH:(.+)$/);
  if (sameBranchMatch) {
    const branch = sameBranchMatch[1];
    return {
      code: 'PR_SAME_BRANCH',
      message: `You're on "${branch}", the repository's default branch. Create and switch to a feature branch first (e.g. \`git checkout -b my-feature\`), then create the PR.`,
    };
  }
  // gh pr create failures arrive as "gh pr create failed: <stderr>" — surface
  // the underlying stderr rather than the wrapper for a clearer message.
  const ghMatch = raw.match(/^gh pr create failed:\s*(.*)$/);
  if (ghMatch) {
    const inner = ghMatch[1].trim();
    if (/not logged in|authenticat/i.test(inner)) {
      return { code: null, message: `GitHub CLI is not authenticated. Run \`gh auth login\`, then retry. (${inner})` };
    }
    return { code: null, message: `Could not create the PR: ${inner}` };
  }
  return { code: null, message: raw };
}

function applyReviewError(error: unknown, fallback: string): void {
  const { code, message } = resolveReviewError(error, fallback);
  setReviewErrorCode(code);
  setReviewError(message);
}

// Plain string extraction for error signals that only need a message
// (no machine-readable code / install-action wiring).
function errorMessage(error: unknown, fallback: string): string {
  if (typeof error === 'string') return error;
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

// Whether the renderer can offer a one-click fix for the current review error.
// Driven by the stable backend code surfaced in `reviewErrorCode()`.
const hasInstallableReviewError = () =>
  reviewErrorCode() != null && ACTIONABLE_REVIEW_ERROR_CODES.has(reviewErrorCode() as string);

const [installingTools, setInstallingTools] = createSignal(false);
// True while we re-probe git after an install — drives the Retry button label.
const [retryingReview, setRetryingReview] = createSignal(false);

// Launches the native macOS Command Line Tools installer via the Tauri command,
// then immediately re-probes git. `xcode-select --install` opens the macOS GUI
// installer (the user still clicks Install there); the git shim at /usr/bin/git
// resolves the developer path at *runtime*, so a fresh probe works as soon as
// the tools are in place — no app restart needed. Non-Tauri (browser dev) and
// non-macOS hosts get a clear message instead of a silent no-op.
async function installCommandLineTools(): Promise<void> {
  setInstallingTools(true);
  setReviewErrorCode(null);
  try {
    await invoke('install_macos_command_line_tools');
    setReviewError(
      'The macOS installer has opened. Click Install in that prompt, then press Retry once it finishes.',
    );
  } catch (e) {
    setReviewError(
      e instanceof Error && e.message
        ? `Could not start the installer: ${e.message}. Run \`xcode-select --install\` from a terminal, then Retry.`
        : 'Could not start the installer. Run `xcode-select --install` from a terminal, then press Retry.',
    );
  } finally {
    setInstallingTools(false);
  }
}

// Re-probes git in the current workspace. Used both as a manual "Retry" action
// (after the user completes the OS installer) and internally to self-heal a
// stale MACOS_DEVELOPER_TOOLS_MISSING error. fetchReview already clears the
// error/code, so success dissolves the error state entirely.
async function retryReview(): Promise<void> {
  setRetryingReview(true);
  try {
    await fetchReview();
  } finally {
    setRetryingReview(false);
  }
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
  reviewErrorCode,
  hasInstallableReviewError,
  installingTools,
  retryingReview,
  selectedReviewPath,
  actionBusyKey,
  actionLog,
  reviewActionInFlight,
  createdPrUrl,
  currentBranch,
  defaultBranch,
  isOnDefaultBranch,
  reviewShipInfo,
  commitMessage,
  commitMessageLoading,
  commitMessageError,
  commitMessageErrorLabel,
  hasReviewChanges,
  reviewFileRailWidth,
  setReviewFileRailWidth,
  resetReviewFileRailWidth,
  setWorkspace,
  setWorkspacePath,
  fetchDiff,
  fetchReview,
  fetchReviewShipInfo,
  selectReviewFile,
  stagePath,
  stageAllReviewChanges,
  unstagePath,
  revertPath,
  revertAllReviewChanges,
  commitReview,
  commitThenMaybePush,
  pushReview,
  createPullRequest,
  commitPushAndCreatePullRequest,
  submitReviewPromptToComposer,
  setCommitMessage,
  setCreatedPrUrl,
  generateCommitMessage,
  cancelCommitMessageGeneration,
  installCommandLineTools,
  retryReview,
  clearActionLog: () => setActionLog([]),
  selectDiffFile: setActiveFileIndex,
};
