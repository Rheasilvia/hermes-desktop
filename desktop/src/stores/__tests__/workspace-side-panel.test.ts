import { beforeEach, describe, expect, it, vi } from 'vitest';

const invokeMock = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock.invoke(...args),
}));

const mocks = vi.hoisted(() => ({
  gateway: {
    workspace: {
      children: vi.fn(),
    },
    git: {
      diff: vi.fn(),
    },
    review: {
      files: vi.fn(),
      diff: vi.fn(),
      stage: vi.fn(),
      unstage: vi.fn(),
      revert: vi.fn(),
      commit: vi.fn(),
      push: vi.fn(),
      createPr: vi.fn(),
      generateCommitMessage: vi.fn(),
      defaultBranch: vi.fn(),
      shipInfo: vi.fn().mockResolvedValue({
        current_branch: 'feature/review',
        default_branch: 'main',
        pr_url: null,
        gh_available: true,
        can_create_pr: true,
      }),
    },
    projects: {
      list: vi.fn(),
      upsert: vi.fn(),
      setActive: vi.fn(),
      worktrees: vi.fn(),
      addWorktree: vi.fn(),
      removeWorktree: vi.fn(),
      branches: vi.fn(),
      switchBranch: vi.fn(),
    },
  },
}));

vi.mock('../context.js', () => ({
  getGateway: () => mocks.gateway,
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
}

const tabKinds = (tabs: Array<{ kind: string }>) => tabs.map((tab) => tab.kind);

beforeEach(() => {
  mocks.gateway.review.shipInfo.mockReset().mockResolvedValue({
    current_branch: 'feature/review',
    default_branch: 'main',
    pr_url: null,
    gh_available: true,
    can_create_pr: true,
  });
});

describe('sidePanelStore', () => {
  it('opens to the tools tab shell by default and supports direct tab activation', async () => {
    vi.resetModules();
    const { sidePanelStore } = await import('../side-panel.js');

    sidePanelStore.open('terminal', { cwd: '/repo/PreDoc' });
    sidePanelStore.setPanelWidth(640);

    expect(sidePanelStore.isOpen()).toBe(true);
    expect(sidePanelStore.activeView()).toBe('terminal');
    expect(tabKinds(sidePanelStore.openTabs())).toEqual(['terminal']);
    expect(sidePanelStore.activeTab()?.title).toBe('PreDoc');

    sidePanelStore.setActiveView('review');

    expect(sidePanelStore.activeView()).toBe('review');
    expect(tabKinds(sidePanelStore.openTabs())).toEqual(['terminal', 'review']);

    sidePanelStore.close();
    sidePanelStore.open();

    expect(sidePanelStore.isOpen()).toBe(true);
    expect(sidePanelStore.activeView()).toBe('review');
    expect(tabKinds(sidePanelStore.openTabs())).toEqual(['terminal', 'review']);
    expect(sidePanelStore.panelWidth()).toBe(640);
  });

  it('creates multiple terminal instances while keeping other tools singleton', async () => {
    vi.resetModules();
    const { sidePanelStore } = await import('../side-panel.js');

    const first = sidePanelStore.openTab('terminal', { cwd: '/repo/PreDoc' });
    const second = sidePanelStore.openTab('terminal', { cwd: '/repo/PreDoc' });
    sidePanelStore.openTab('files');
    sidePanelStore.openTab('files');

    expect(first.id).not.toBe(second.id);
    expect(tabKinds(sidePanelStore.openTabs())).toEqual(['terminal', 'terminal', 'files']);
    expect(sidePanelStore.openTabs().map((tab) => tab.title)).toEqual(['PreDoc', 'PreDoc 2', 'Open file']);
    expect(sidePanelStore.activeTabId()).toBe('tool-files');
  });

  it('renames tabs with non-empty titles only', async () => {
    vi.resetModules();
    const { sidePanelStore } = await import('../side-panel.js');

    const tab = sidePanelStore.openTab('terminal', { cwd: '/repo/PreDoc' });

    sidePanelStore.renameTab(tab.id, '  Shell A  ');
    expect(sidePanelStore.openTabs()[0]?.title).toBe('Shell A');

    sidePanelStore.renameTab(tab.id, '   ');
    expect(sidePanelStore.openTabs()[0]?.title).toBe('Shell A');
  });
});

describe('sidePanelStore.closeTab', () => {
  it('leaves the active view and remaining tabs intact when closing a non-active tab', async () => {
    vi.resetModules();
    const { sidePanelStore } = await import('../side-panel.js');

    sidePanelStore.openTab('terminal');
    sidePanelStore.openTab('files');
    sidePanelStore.setActiveView('terminal');

    sidePanelStore.closeTab('files');

    expect(tabKinds(sidePanelStore.openTabs())).toEqual(['terminal']);
    expect(sidePanelStore.activeView()).toBe('terminal');
    expect(sidePanelStore.isOpen()).toBe(true);
  });

  it('reassigns the active view to the right neighbor when the active tab is closed', async () => {
    vi.resetModules();
    const { sidePanelStore } = await import('../side-panel.js');

    sidePanelStore.openTab('terminal');
    sidePanelStore.openTab('files');
    sidePanelStore.openTab('review');
    sidePanelStore.setActiveView('files');

    sidePanelStore.closeTab('files');

    expect(tabKinds(sidePanelStore.openTabs())).toEqual(['terminal', 'review']);
    expect(sidePanelStore.activeView()).toBe('review');
    expect(sidePanelStore.isOpen()).toBe(true);
  });

  it('collapses the dock and resets to the menu state when the last tab is closed', async () => {
    vi.resetModules();
    const { sidePanelStore } = await import('../side-panel.js');

    sidePanelStore.openTab('terminal');
    const tabId = sidePanelStore.activeTabId();
    expect(sidePanelStore.isOpen()).toBe(true);

    sidePanelStore.closeTab(tabId!);

    expect(sidePanelStore.openTabs()).toEqual([]);
    expect(sidePanelStore.activeView()).toBe('menu');
    expect(sidePanelStore.isOpen()).toBe(false);
  });
});

describe('sidePanelStore tool menu request', () => {
  it('clears the pending add-tool menu request when the dock closes', async () => {
    vi.resetModules();
    const { sidePanelStore } = await import('../side-panel.js');

    sidePanelStore.open();
    sidePanelStore.requestToolMenuOpen();

    expect(sidePanelStore.toolMenuOpenRequested()).toBe(true);

    sidePanelStore.close();

    expect(sidePanelStore.toolMenuOpenRequested()).toBe(false);

    sidePanelStore.requestToolMenuOpen();
    sidePanelStore.clearTabs();

    expect(sidePanelStore.toolMenuOpenRequested()).toBe(false);
  });
});

describe('gitViewStore', () => {
  it('clears old diff state on workspace changes and ignores stale responses', async () => {
    vi.resetModules();
    const first = deferred<unknown>();
    const second = deferred<unknown>();
    mocks.gateway.git.diff
      .mockReset()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const { gitViewStore } = await import('../git-view.js');

    gitViewStore.setWorkspace('session-one', '/workspace-one');
    const firstFetch = gitViewStore.fetchDiff();
    gitViewStore.setWorkspace('session-two', '/workspace-two');
    const secondFetch = gitViewStore.fetchDiff();

    second.resolve({ files: [], summary: { files_changed: 0, insertions: 0, deletions: 0 }, working_dir: '/workspace-two' });
    await secondFetch;
    first.resolve({ files: [], summary: { files_changed: 1, insertions: 1, deletions: 0 }, working_dir: '/workspace-one' });
    await firstFetch;

    expect(gitViewStore.diffData()?.working_dir).toBe('/workspace-two');
    expect(gitViewStore.diffData()?.summary.files_changed).toBe(0);
    expect(gitViewStore.diffError()).toBeNull();
    expect(mocks.gateway.git.diff).toHaveBeenCalledWith('session-one');
    expect(mocks.gateway.git.diff).toHaveBeenCalledWith('session-two');
  });

  it('refreshes review state after staging a selected file', async () => {
    vi.resetModules();
    mocks.gateway.review.files
      .mockReset()
      .mockResolvedValue({
        files: [
          { path: 'src/app.ts', old_path: null, status: 'modified', staged: false, unstaged: true, untracked: false, insertions: 2, deletions: 1 },
        ],
        summary: { files_changed: 1, insertions: 2, deletions: 1, staged_count: 0, unstaged_count: 1, untracked_count: 0 },
        working_dir: '/repo',
        branch: 'main',
      });
    mocks.gateway.review.diff
      .mockReset()
      .mockResolvedValue({ files: [], summary: { files_changed: 0, insertions: 0, deletions: 0 }, working_dir: '/repo' });
    mocks.gateway.review.stage.mockReset().mockResolvedValue({ ok: true });
    const { gitViewStore } = await import('../git-view.js');

    gitViewStore.setWorkspace('session-one', '/repo');
    await gitViewStore.fetchReview();
    await gitViewStore.stagePath('src/app.ts');

    expect(mocks.gateway.review.stage).toHaveBeenCalledWith('session-one', ['src/app.ts']);
    expect(mocks.gateway.review.files).toHaveBeenCalledTimes(2);
    expect(gitViewStore.selectedReviewPath()).toBe('src/app.ts');
  });

  it('ignores cancelled commit message generation results', async () => {
    vi.resetModules();
    const generation = deferred<unknown>();
    mocks.gateway.review.generateCommitMessage
      .mockReset()
      .mockReturnValueOnce(generation.promise);
    const { gitViewStore } = await import('../git-view.js');

    gitViewStore.setWorkspace('session-one', '/repo');
    const pending = gitViewStore.generateCommitMessage();
    expect(gitViewStore.commitMessageLoading()).toBe(true);

    gitViewStore.cancelCommitMessageGeneration();
    generation.resolve({ status: 'generated', message: 'fix: stale result' });
    await pending;

    expect(gitViewStore.commitMessage()).toBe('');
    expect(gitViewStore.commitMessageLoading()).toBe(false);
  });

  it('humanizes NO_DIFF commit message generation instead of leaking the backend code', async () => {
    vi.resetModules();
    mocks.gateway.review.generateCommitMessage
      .mockReset()
      .mockResolvedValueOnce({ status: 'failed', message: null, detail: 'NO_DIFF' });
    const { gitViewStore } = await import('../git-view.js');

    gitViewStore.setWorkspace('session-one', '/repo');
    await gitViewStore.generateCommitMessage();

    expect(gitViewStore.commitMessageError()).toBe('NO_DIFF');
    expect(gitViewStore.commitMessageErrorLabel()).toBe('No changes to summarize.');
  });

  it('clears stale selected diff and commit-message error when review refresh returns clean', async () => {
    vi.resetModules();
    mocks.gateway.review.files
      .mockReset()
      .mockResolvedValueOnce({
        files: [
          { path: 'src/app.ts', old_path: null, status: 'modified', staged: false, unstaged: true, untracked: false, insertions: 2, deletions: 1 },
        ],
        summary: { files_changed: 1, insertions: 2, deletions: 1, staged_count: 0, unstaged_count: 1, untracked_count: 0 },
        working_dir: '/repo',
        branch: 'main',
      })
      .mockResolvedValueOnce({
        files: [],
        summary: { files_changed: 0, insertions: 0, deletions: 0, staged_count: 0, unstaged_count: 0, untracked_count: 0 },
        working_dir: '/repo',
        branch: 'main',
      });
    mocks.gateway.review.diff
      .mockReset()
      .mockResolvedValueOnce({
        files: [{ path: 'src/app.ts', old_path: null, status: 'modified', hunks: [] }],
        summary: { files_changed: 1, insertions: 2, deletions: 1 },
        working_dir: '/repo',
      });
    mocks.gateway.review.generateCommitMessage
      .mockReset()
      .mockResolvedValueOnce({ status: 'failed', message: null, detail: 'NO_DIFF' });
    const { gitViewStore } = await import('../git-view.js');

    gitViewStore.setWorkspace('session-one', '/repo');
    await gitViewStore.fetchReview();
    await gitViewStore.generateCommitMessage();
    expect(gitViewStore.selectedReviewPath()).toBe('src/app.ts');
    expect(gitViewStore.diffData()?.summary.files_changed).toBe(1);
    expect(gitViewStore.commitMessageError()).toBe('NO_DIFF');

    await gitViewStore.fetchReview();

    expect(gitViewStore.hasReviewChanges()).toBe(false);
    expect(gitViewStore.selectedReviewPath()).toBeNull();
    expect(gitViewStore.diffData()).toBeNull();
    expect(gitViewStore.commitMessageError()).toBeNull();
  });

  it('surfaces an actionable install action when git fails with MACOS_DEVELOPER_TOOLS_MISSING', async () => {
    vi.resetModules();
    mocks.gateway.review.files
      .mockReset()
      .mockRejectedValue(new Error('MACOS_DEVELOPER_TOOLS_MISSING'));
    invokeMock.invoke.mockReset().mockResolvedValue(undefined);
    const { gitViewStore } = await import('../git-view.js');

    gitViewStore.setWorkspace('session-one', '/repo');
    await gitViewStore.fetchReview();

    expect(gitViewStore.reviewErrorCode()).toBe('MACOS_DEVELOPER_TOOLS_MISSING');
    expect(gitViewStore.hasInstallableReviewError()).toBe(true);
    expect(gitViewStore.reviewError()).toContain('Command Line Tools');

    await gitViewStore.installCommandLineTools();

    expect(invokeMock.invoke).toHaveBeenCalledWith('install_macos_command_line_tools');
    expect(gitViewStore.installingTools()).toBe(false);
    // After launching the installer we no longer show the actionable code — the
    // guidance switches to "press Retry", so the install button hides.
    expect(gitViewStore.reviewErrorCode()).toBeNull();
    expect(gitViewStore.hasInstallableReviewError()).toBe(false);
    expect(gitViewStore.reviewError()).toContain('Retry');
  });

  it('self-heals the error when retry re-fetches review after a fix', async () => {
    vi.resetModules();
    // First fetch fails with the missing-tools error.
    mocks.gateway.review.files
      .mockReset()
      .mockRejectedValueOnce(new Error('MACOS_DEVELOPER_TOOLS_MISSING'))
      .mockResolvedValueOnce({
        files: [],
        summary: {
          files_changed: 0, insertions: 0, deletions: 0,
          staged_count: 0, unstaged_count: 0, untracked_count: 0,
        },
        working_dir: '/repo',
        branch: 'main',
      });
    const { gitViewStore } = await import('../git-view.js');

    gitViewStore.setWorkspace('session-one', '/repo');
    await gitViewStore.fetchReview();
    expect(gitViewStore.hasInstallableReviewError()).toBe(true);

    // User fixes the toolchain, hits Retry → review now succeeds → error clears.
    await gitViewStore.retryReview();

    expect(gitViewStore.reviewErrorCode()).toBeNull();
    expect(gitViewStore.reviewError()).toBeNull();
    expect(gitViewStore.retryingReview()).toBe(false);
  });

  it('does not flag a generic git error as installable', async () => {
    vi.resetModules();
    mocks.gateway.review.files
      .mockReset()
      .mockRejectedValue(new Error('git push failed: permission denied'));
    const { gitViewStore } = await import('../git-view.js');

    gitViewStore.setWorkspace('session-one', '/repo');
    await gitViewStore.fetchReview();

    expect(gitViewStore.reviewErrorCode()).toBeNull();
    expect(gitViewStore.hasInstallableReviewError()).toBe(false);
  });
});

describe('gitViewStore review actions', () => {
  const filesWith = (files: Array<Record<string, unknown>>) => ({
    files,
    summary: {
      files_changed: files.length,
      insertions: 0, deletions: 0,
      staged_count: files.filter((f) => f.staged).length,
      unstaged_count: files.filter((f) => f.unstaged).length,
      untracked_count: files.filter((f) => f.untracked).length,
    },
    working_dir: '/repo',
    branch: 'main',
  });

  it('optimistically stages a file and reconciles via a files-only refresh', async () => {
    vi.resetModules();
    mocks.gateway.review.files
      .mockReset()
      .mockResolvedValueOnce(filesWith([
        { path: 'a.txt', old_path: null, status: 'modified', staged: false, unstaged: true, untracked: false, insertions: 1, deletions: 0 },
      ]))
      .mockResolvedValueOnce(filesWith([
        { path: 'a.txt', old_path: null, status: 'modified', staged: true, unstaged: false, untracked: false, insertions: 1, deletions: 0 },
      ]));
    mocks.gateway.review.diff.mockReset().mockResolvedValue({ files: [], summary: { files_changed: 0, insertions: 0, deletions: 0 }, working_dir: '/repo' });
    mocks.gateway.review.stage.mockReset().mockResolvedValue({ ok: true });
    const { gitViewStore } = await import('../git-view.js');

    gitViewStore.setWorkspace('session-one', '/repo');
    await gitViewStore.fetchReview();
    expect(gitViewStore.reviewData()?.files[0].staged).toBe(false);

    await gitViewStore.stagePath('a.txt');

    // Stage recorded as a successful action in the log.
    const log = gitViewStore.actionLog;
    expect(log.length).toBeGreaterThan(0);
    const lastEntry = log[log.length - 1];
    expect(lastEntry.status).toBe('success');
    expect(lastEntry.kind).toBe('stage');
    // Reconciled list confirms staged.
    expect(gitViewStore.reviewData()?.files[0].staged).toBe(true);
    // In-flight guard released.
    expect(gitViewStore.reviewActionInFlight()).toBe(false);
  });

  it('stages all unstaged and untracked review files through the backend', async () => {
    vi.resetModules();
    mocks.gateway.review.files
      .mockReset()
      .mockResolvedValueOnce(filesWith([
        { path: 'a.txt', old_path: null, status: 'modified', staged: false, unstaged: true, untracked: false, insertions: 1, deletions: 0 },
        { path: 'b.txt', old_path: null, status: 'modified', staged: true, unstaged: false, untracked: false, insertions: 1, deletions: 0 },
        { path: 'c.txt', old_path: null, status: 'added', staged: false, unstaged: false, untracked: true, insertions: 1, deletions: 0 },
      ]))
      .mockResolvedValueOnce(filesWith([
        { path: 'a.txt', old_path: null, status: 'modified', staged: true, unstaged: false, untracked: false, insertions: 1, deletions: 0 },
        { path: 'b.txt', old_path: null, status: 'modified', staged: true, unstaged: false, untracked: false, insertions: 1, deletions: 0 },
        { path: 'c.txt', old_path: null, status: 'added', staged: true, unstaged: false, untracked: false, insertions: 1, deletions: 0 },
      ]));
    mocks.gateway.review.diff
      .mockReset()
      .mockResolvedValue({ files: [], summary: { files_changed: 0, insertions: 0, deletions: 0 }, working_dir: '/repo' });
    mocks.gateway.review.stage.mockReset().mockResolvedValue({ ok: true });
    const { gitViewStore } = await import('../git-view.js');

    gitViewStore.setWorkspace('session-one', '/repo');
    await gitViewStore.fetchReview();
    const staged = await gitViewStore.stageAllReviewChanges();

    expect(staged).toBe(true);
    expect(mocks.gateway.review.stage).toHaveBeenCalledWith('session-one', ['a.txt', 'c.txt']);
    expect(gitViewStore.reviewData()?.summary.staged_count).toBe(3);
  });

  it('stages current changes before committing when nothing is staged', async () => {
    vi.resetModules();
    mocks.gateway.review.files
      .mockReset()
      .mockResolvedValueOnce(filesWith([
        { path: 'a.txt', old_path: null, status: 'modified', staged: false, unstaged: true, untracked: false, insertions: 1, deletions: 0 },
        { path: 'b.txt', old_path: null, status: 'added', staged: false, unstaged: false, untracked: true, insertions: 1, deletions: 0 },
      ]))
      .mockResolvedValueOnce(filesWith([
        { path: 'a.txt', old_path: null, status: 'modified', staged: true, unstaged: false, untracked: false, insertions: 1, deletions: 0 },
        { path: 'b.txt', old_path: null, status: 'added', staged: true, unstaged: false, untracked: false, insertions: 1, deletions: 0 },
      ]))
      .mockResolvedValueOnce(filesWith([]));
    mocks.gateway.review.diff
      .mockReset()
      .mockResolvedValue({ files: [], summary: { files_changed: 0, insertions: 0, deletions: 0 }, working_dir: '/repo' });
    mocks.gateway.review.stage.mockReset().mockResolvedValue({ ok: true });
    mocks.gateway.review.commit.mockReset().mockResolvedValue({ ok: true, detail: null });
    const { gitViewStore } = await import('../git-view.js');

    gitViewStore.setWorkspace('session-one', '/repo');
    await gitViewStore.fetchReview();
    const committed = await gitViewStore.commitThenMaybePush({ message: 'feat: ship review' });

    expect(committed).toBe(true);
    expect(mocks.gateway.review.stage).toHaveBeenCalledWith('session-one', ['a.txt', 'b.txt']);
    expect(mocks.gateway.review.commit).toHaveBeenCalledWith('session-one', 'feat: ship review');
    expect(mocks.gateway.review.stage.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.gateway.review.commit.mock.invocationCallOrder[0],
    );
  });

  it('commits then records a partial failure when push fails', async () => {
    vi.resetModules();
    mocks.gateway.review.files
      .mockReset()
      .mockResolvedValueOnce(filesWith([
        { path: 'a.txt', old_path: null, status: 'modified', staged: true, unstaged: false, untracked: false, insertions: 1, deletions: 0 },
      ]))
      .mockResolvedValueOnce(filesWith([]));
    mocks.gateway.review.diff
      .mockReset()
      .mockResolvedValue({ files: [], summary: { files_changed: 0, insertions: 0, deletions: 0 }, working_dir: '/repo' });
    mocks.gateway.review.commit.mockReset().mockResolvedValue({ ok: true, detail: null });
    mocks.gateway.review.push.mockReset().mockRejectedValue(new Error('permission denied'));
    const { gitViewStore } = await import('../git-view.js');

    gitViewStore.setWorkspace('session-one', '/repo');
    await gitViewStore.fetchReview();
    const shipped = await gitViewStore.commitThenMaybePush({ message: 'fix: staged file', push: true });

    expect(shipped).toBe(false);
    expect(mocks.gateway.review.commit).toHaveBeenCalledWith('session-one', 'fix: staged file');
    expect(mocks.gateway.review.push).toHaveBeenCalledWith('session-one');
    const lastEntry = gitViewStore.actionLog[gitViewStore.actionLog.length - 1];
    expect(lastEntry.kind).toBe('push');
    expect(lastEntry.status).toBe('failed');
    expect(lastEntry.message).toContain('Committed, but push failed');
    expect(lastEntry.message).toContain('permission denied');
  });

  it('captures the created PR url and surfaces it via the store', async () => {
    vi.resetModules();
    mocks.gateway.review.files.mockReset().mockResolvedValue(filesWith([]));
    mocks.gateway.review.diff.mockReset().mockResolvedValue({ files: [], summary: { files_changed: 0, insertions: 0, deletions: 0 }, working_dir: '/repo' });
    mocks.gateway.review.createPr.mockReset().mockResolvedValue({ ok: true, url: 'https://github.com/me/repo/pull/42', detail: null });
    mocks.gateway.review.shipInfo.mockReset().mockResolvedValue({
      current_branch: 'main',
      default_branch: 'main',
      pr_url: null,
      gh_available: true,
      can_create_pr: false,
    });
    const { gitViewStore } = await import('../git-view.js');

    gitViewStore.setWorkspace('session-one', '/repo');
    await gitViewStore.fetchReview();
    await gitViewStore.createPullRequest();

    expect(gitViewStore.createdPrUrl()).toBe('https://github.com/me/repo/pull/42');
  });

  it('fetches ship info and opens an existing PR instead of creating a duplicate', async () => {
    vi.resetModules();
    mocks.gateway.review.shipInfo.mockReset().mockResolvedValue({
      current_branch: 'feature/review',
      default_branch: 'main',
      pr_url: 'https://github.com/me/repo/pull/42',
      gh_available: true,
      can_create_pr: true,
    });
    mocks.gateway.review.createPr.mockReset().mockResolvedValue({ ok: true, url: 'https://github.com/me/repo/pull/99', detail: null });
    invokeMock.invoke.mockReset().mockResolvedValue(undefined);
    const { gitViewStore } = await import('../git-view.js');

    gitViewStore.setWorkspace('session-one', '/repo');
    await gitViewStore.fetchReviewShipInfo();
    await gitViewStore.createPullRequest();

    expect(gitViewStore.reviewShipInfo()?.pr_url).toBe('https://github.com/me/repo/pull/42');
    expect(gitViewStore.createdPrUrl()).toBe('https://github.com/me/repo/pull/42');
    expect(invokeMock.invoke).toHaveBeenCalledWith('open_external', { url: 'https://github.com/me/repo/pull/42' });
    expect(mocks.gateway.review.createPr).not.toHaveBeenCalled();
  });

  it('clears the cached PR url when ship info no longer reports one', async () => {
    vi.resetModules();
    mocks.gateway.review.shipInfo
      .mockReset()
      .mockResolvedValueOnce({
        current_branch: 'feature/review',
        default_branch: 'main',
        pr_url: 'https://github.com/me/repo/pull/42',
        gh_available: true,
        can_create_pr: true,
      })
      .mockResolvedValueOnce({
        current_branch: 'feature/other',
        default_branch: 'main',
        pr_url: null,
        gh_available: true,
        can_create_pr: true,
      });
    const { gitViewStore } = await import('../git-view.js');

    gitViewStore.setWorkspace('session-one', '/repo');
    await gitViewStore.fetchReviewShipInfo();
    expect(gitViewStore.createdPrUrl()).toBe('https://github.com/me/repo/pull/42');

    await gitViewStore.fetchReviewShipInfo();

    expect(gitViewStore.reviewShipInfo()?.pr_url).toBeNull();
    expect(gitViewStore.createdPrUrl()).toBeNull();
  });

  it('records a single-action failure in the action log, not the full-panel reviewError', async () => {
    vi.resetModules();
    mocks.gateway.review.files.mockReset().mockResolvedValue(filesWith([]));
    mocks.gateway.review.diff.mockReset().mockResolvedValue({ files: [], summary: { files_changed: 0, insertions: 0, deletions: 0 }, working_dir: '/repo' });
    mocks.gateway.review.defaultBranch.mockReset().mockResolvedValue(null);
    mocks.gateway.review.push.mockReset().mockRejectedValue(new Error('git push failed: permission denied'));
    const { gitViewStore } = await import('../git-view.js');

    gitViewStore.setWorkspace('session-one', '/repo');
    await gitViewStore.fetchReview();
    await gitViewStore.pushReview();

    // Failure recorded in the collapsible status-panel log.
    const log = gitViewStore.actionLog;
    const lastEntry = log[log.length - 1];
    expect(lastEntry.status).toBe('failed');
    expect(lastEntry.message).toBe('git push failed: permission denied');
    // The review itself loaded fine — the diff stays visible, reviewError null.
    expect(gitViewStore.reviewError()).toBeNull();
  });

  it('maps PR_SAME_BRANCH to actionable guidance instead of raw gh stderr', async () => {
    vi.resetModules();
    mocks.gateway.review.files.mockReset().mockResolvedValue(filesWith([]));
    mocks.gateway.review.diff.mockReset().mockResolvedValue({ files: [], summary: { files_changed: 0, insertions: 0, deletions: 0 }, working_dir: '/repo' });
    mocks.gateway.review.defaultBranch.mockReset().mockResolvedValue(null);
    // Backend pre-flight returns a clear code; renderer must humanize it.
    mocks.gateway.review.createPr.mockReset().mockRejectedValue(new Error('PR_SAME_BRANCH:main'));
    const { gitViewStore } = await import('../git-view.js');

    gitViewStore.setWorkspace('session-one', '/repo');
    await gitViewStore.fetchReview();
    await gitViewStore.createPullRequest();

    // The humanized message lands in the last log entry.
    const log = gitViewStore.actionLog;
    const lastEntry = log[log.length - 1];
    const err = lastEntry.message;
    expect(err).toContain('default branch');
    expect(err).toContain('feature branch');
    // The raw gh-style message must NOT leak through.
    expect(err).not.toContain('PR_SAME_BRANCH');
    expect(err).not.toContain('head branch');
  });
});

describe('workspaceTreeStore', () => {
  it('does not leak expanded paths between workspaces', async () => {
    vi.resetModules();
    mocks.gateway.workspace.children.mockReset();
    mocks.gateway.workspace.children.mockImplementation(async (_sessionId: string, path: string) => {
        return {
          root: path,
          path,
          children: path === '/one'
            ? [{ path: '/one/src', name: 'src', kind: 'directory', ignored: false, loaded: false }]
            : [{ path: '/two/app', name: 'app', kind: 'directory', ignored: false, loaded: false }],
          truncated: false,
          total_read: 1,
        };
    });
    const { workspaceTreeStore } = await import('../workspace-tree.js');

    await workspaceTreeStore.setWorkspace('session-one', '/one');
    await workspaceTreeStore.toggleExpanded('/one/src');
    await workspaceTreeStore.setWorkspace('session-two', '/two');

    expect(workspaceTreeStore.state()?.root).toBe('/two');
    expect(workspaceTreeStore.state()?.expanded.has('/one/src')).toBe(false);
    expect(workspaceTreeStore.rows().map((row) => row.node.path)).toEqual(['/two', '/two/app']);
    expect(mocks.gateway.workspace.children).toHaveBeenCalledWith('session-one', '/one');
    expect(mocks.gateway.workspace.children).toHaveBeenCalledWith('session-two', '/two');
  });

  it('ignores stale tree responses after the workspace changes', async () => {
    vi.resetModules();
    const firstList = deferred<unknown>();
    const secondList = deferred<unknown>();
    mocks.gateway.workspace.children.mockReset();
    mocks.gateway.workspace.children.mockImplementation((_sessionId: string, path: string) => {
      return path === '/one' ? firstList.promise : secondList.promise;
    });
    const { workspaceTreeStore } = await import('../workspace-tree.js');

    const firstSet = workspaceTreeStore.setWorkspace('session-one', '/one');
    await flushPromises();
    const secondSet = workspaceTreeStore.setWorkspace('session-two', '/two');
    await flushPromises();

    secondList.resolve({
      root: '/two',
      path: '/two',
      children: [{ path: '/two/current.ts', name: 'current.ts', kind: 'file', ignored: false, loaded: true }],
      truncated: false,
      total_read: 1,
    });
    await secondSet;
    firstList.resolve({
      root: '/one',
      path: '/one',
      children: [{ path: '/one/stale.ts', name: 'stale.ts', kind: 'file', ignored: false, loaded: true }],
      truncated: false,
      total_read: 1,
    });
    await firstSet;

    expect(workspaceTreeStore.state()?.root).toBe('/two');
    expect(workspaceTreeStore.rows().map((row) => row.node.path)).toEqual(['/two', '/two/current.ts']);
  });
});

describe('projectStore', () => {
  it('loads backend-authoritative projects and active path', async () => {
    vi.resetModules();
    mocks.gateway.projects.list.mockReset().mockResolvedValue({
      projects: [{ path: '/repo', name: 'repo', last_opened_at: 1 }],
      active_path: '/repo',
    });
    const { projectStore } = await import('../projects.js');

    await projectStore.load();

    expect(projectStore.projects().map((project) => project.path)).toEqual(['/repo']);
    expect(projectStore.activePath()).toBe('/repo');
  });

  it('persists active project through the backend', async () => {
    vi.resetModules();
    mocks.gateway.projects.setActive.mockReset().mockResolvedValue({
      projects: [{ path: '/repo', name: 'repo', last_opened_at: 1 }],
      active_path: '/repo',
    });
    const { projectStore } = await import('../projects.js');

    await projectStore.setActiveProject('/repo');

    expect(mocks.gateway.projects.setActive).toHaveBeenCalledWith('/repo');
    expect(projectStore.activePath()).toBe('/repo');
  });
});
