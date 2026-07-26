import { fireEvent, render, screen, within } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DiffFile, FileStatus, GitDiffResult } from '@/types/diff.js';
import type { ReviewFilesResult } from '@/types/review.js';
import { DiffPanel } from '../DiffPanel.js';

const makeFile = (path: string, status: FileStatus = 'modified'): DiffFile => ({
  path,
  old_path: null,
  status,
  hunks: [
    {
      header: '@@ -1,1 +1,1 @@',
      old_start: 1,
      old_count: 1,
      new_start: 1,
      new_count: 1,
      lines: [
        {
          kind: 'context',
          old_lineno: 1,
          new_lineno: 1,
          content: `${path} line`,
        },
      ],
    },
  ],
});

const makeResult = (): GitDiffResult => ({
  files: [
    makeFile('src/first.ts'),
    makeFile('src/components/second.ts', 'added'),
    ...Array.from({ length: 60 }, (_, index) => makeFile(`src/generated/file-${index}.ts`)),
  ],
  summary: { files_changed: 2, insertions: 4, deletions: 1 },
  working_dir: '/repo',
});

const makeReviewResult = (): ReviewFilesResult => ({
  files: [
    {
      path: 'src/first.ts',
      old_path: null,
      status: 'modified',
      staged: false,
      unstaged: true,
      untracked: false,
      insertions: 4,
      deletions: 1,
    },
    {
      path: 'src/new.ts',
      old_path: null,
      status: 'added',
      staged: true,
      unstaged: false,
      untracked: false,
      insertions: 2,
      deletions: 0,
    },
  ],
  summary: {
    files_changed: 2,
    insertions: 6,
    deletions: 1,
    staged_count: 1,
    unstaged_count: 1,
    untracked_count: 0,
  },
  working_dir: '/repo',
  branch: 'main',
});

const makeCleanReviewResult = (): ReviewFilesResult => ({
  files: [],
  summary: {
    files_changed: 0,
    insertions: 0,
    deletions: 0,
    staged_count: 0,
    unstaged_count: 0,
    untracked_count: 0,
  },
  working_dir: '/repo',
  branch: 'main',
});

const mockReviewBodyWidth = (width: number) => {
  vi.stubGlobal('ResizeObserver', class ResizeObserverMock {
    private readonly callback: ResizeObserverCallback;

    constructor(callback: ResizeObserverCallback) {
      this.callback = callback;
    }

    observe(target: Element) {
      const targetWidth = target.getAttribute('data-testid') === 'review-split-body' ? width : 320;
      const targetHeight = target.getAttribute('data-testid') === 'diff-file-list' ? 320 : 600;
      this.callback([
        {
          target,
          contentRect: {
            width: targetWidth,
            height: targetHeight,
            top: 0,
            left: 0,
            bottom: targetHeight,
            right: targetWidth,
            x: 0,
            y: 0,
            toJSON: () => ({}),
          },
        } as ResizeObserverEntry,
      ], this as unknown as ResizeObserver);
    }

    unobserve() {}
    disconnect() {}
  });

  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function clientWidth(this: HTMLElement) {
    return this.getAttribute('data-testid') === 'review-split-body' ? width : 320;
  });
};

describe('DiffPanel', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('keeps Git changes title and summary while moving file selection into the navigator', () => {
    const onSelectFile = vi.fn();
    render(() => (
      <DiffPanel
        visible={true}
        data={makeResult()}
        loading={false}
        error={null}
        hasWorkspace={true}
        activeFileIndex={0}
        onSelectFile={onSelectFile}
      />
    ));

    const header = screen.getByText('Git changes').parentElement;
    expect(header?.className).toContain('diffPanelHeader');
    expect(header?.contains(screen.getByRole('button', { name: /Open changed files/ }))).toBe(true);
    expect(header?.textContent).toContain('+4');
    expect(header?.textContent).toContain('−1');
    expect(screen.getByRole('tree', { name: 'Changed files' })).toBeTruthy();
    expect(screen.getByRole('separator', { name: 'Resize changed files pane' })).toBeTruthy();
    expect(screen.getAllByTestId('diff-file-row').length).toBeLessThan(40);
    expect(screen.getAllByText('first.ts').length).toBeGreaterThan(0);
    expect(screen.getByRole('treeitem', { name: /second\.ts/ })).toBeTruthy();
    expect(onSelectFile).not.toHaveBeenCalled();
  });

  it('opens a searchable file drawer in narrow mode and selects the original file index', async () => {
    const onSelectFile = vi.fn();
    mockReviewBodyWidth(620);
    render(() => (
      <DiffPanel
        visible={true}
        data={makeResult()}
        loading={false}
        error={null}
        hasWorkspace={true}
        activeFileIndex={0}
        onSelectFile={onSelectFile}
      />
    ));

    await fireEvent.click(screen.getByRole('button', { name: /Open changed files/ }));
    const dialog = screen.getByRole('dialog', { name: 'Changed files' });
    const drawer = within(dialog);
    await fireEvent.input(drawer.getByPlaceholderText('Search files'), {
      target: { value: 'second' },
    });
    await fireEvent.click(drawer.getByRole('treeitem', { name: /second\.ts/ }));

    expect(onSelectFile).toHaveBeenCalledWith(1);
    expect(screen.queryByRole('dialog', { name: 'Changed files' })).toBeNull();
  });

  it('closes the file drawer with Escape and outside pointer down', async () => {
    mockReviewBodyWidth(620);
    render(() => (
      <DiffPanel
        visible={true}
        data={makeResult()}
        loading={false}
        error={null}
        hasWorkspace={true}
        activeFileIndex={0}
      />
    ));

    await fireEvent.click(screen.getByRole('button', { name: /Open changed files/ }));
    expect(screen.getByRole('dialog', { name: 'Changed files' })).toBeTruthy();
    await fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Changed files' })).toBeNull();

    await fireEvent.click(screen.getByRole('button', { name: /Open changed files/ }));
    await fireEvent.pointerDown(screen.getByTestId('diff-file-drawer-backdrop'));
    expect(screen.queryByRole('dialog', { name: 'Changed files' })).toBeNull();
  });

  it('renders review files and dispatches file actions by path', async () => {
    const onSelectReviewFile = vi.fn();
    const onStageFile = vi.fn();
    const onUnstageFile = vi.fn();
    const onRevertFile = vi.fn();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(() => (
      <DiffPanel
        visible={true}
        data={{ ...makeResult(), files: [makeFile('src/first.ts')] }}
        loading={false}
        error={null}
        hasWorkspace={true}
        reviewData={makeReviewResult()}
        selectedReviewPath="src/first.ts"
        onSelectReviewFile={onSelectReviewFile}
        onStageFile={onStageFile}
        onUnstageFile={onUnstageFile}
        onRevertFile={onRevertFile}
      />
    ));

    expect(screen.getByText('Staged')).toBeTruthy();
    expect(screen.getByText('+6')).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: 'Stage' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Revert' }));
    await fireEvent.click(screen.getByRole('treeitem', { name: /new\.ts/ }));

    expect(onStageFile).toHaveBeenCalledWith('src/first.ts');
    expect(onRevertFile).toHaveBeenCalledWith('src/first.ts');
    expect(onSelectReviewFile).toHaveBeenCalledWith('src/new.ts');
    expect(onUnstageFile).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it('surfaces commit controls from the ship popover and preserves failures inside the panel', async () => {
    const onCommitMessageChange = vi.fn();
    const onGenerateCommitMessage = vi.fn();
    const onCancelGenerateCommitMessage = vi.fn();
    const onCommit = vi.fn();
    const onCommitPush = vi.fn();
    const onCommitPushCreatePr = vi.fn();
    const onCreatePr = vi.fn();

    render(() => (
      <DiffPanel
        visible={true}
        data={{ ...makeResult(), files: [makeFile('src/new.ts', 'added')] }}
        loading={false}
        error={null}
        hasWorkspace={true}
        reviewData={makeReviewResult()}
        selectedReviewPath="src/new.ts"
        commitMessage="feat: add review"
        commitMessageError="Commit message generation is unavailable."
        onCommitMessageChange={onCommitMessageChange}
        onGenerateCommitMessage={onGenerateCommitMessage}
        onCancelGenerateCommitMessage={onCancelGenerateCommitMessage}
        onCommit={onCommit}
        onCommitPush={onCommitPush}
        onCommitPushCreatePr={onCommitPushCreatePr}
        onCreatePr={onCreatePr}
      />
    ));

    await fireEvent.click(screen.getByRole('button', { name: 'Commit or push' }));
    await fireEvent.input(screen.getByLabelText('Commit message'), {
      target: { value: 'fix: changed' },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Generate' }));
    await fireEvent.click(screen.getByRole('button', { name: /^Commit$/ }));
    await fireEvent.click(screen.getByRole('button', { name: 'Commit & Push' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Commit, Push & PR' }));
    await fireEvent.click(screen.getByRole('button', { name: /Create PR from existing commits/ }));

    expect(onCommitMessageChange).toHaveBeenCalledWith('fix: changed');
    expect(onGenerateCommitMessage).toHaveBeenCalled();
    expect(onCancelGenerateCommitMessage).not.toHaveBeenCalled();
    expect(onCommit).toHaveBeenCalledWith('feat: add review');
    expect(onCommitPush).toHaveBeenCalledWith('feat: add review');
    expect(onCommitPushCreatePr).toHaveBeenCalledWith('feat: add review');
    expect(onCreatePr).toHaveBeenCalled();
    expect(screen.getByText('Commit message generation is unavailable.')).toBeTruthy();
  });

  it('auto-generates a commit message when the ship popover opens empty', async () => {
    const onGenerateCommitMessage = vi.fn();

    render(() => (
      <DiffPanel
        visible={true}
        data={{ ...makeResult(), files: [makeFile('src/new.ts', 'added')] }}
        loading={false}
        error={null}
        hasWorkspace={true}
        reviewData={makeReviewResult()}
        selectedReviewPath="src/new.ts"
        commitMessage=""
        onGenerateCommitMessage={onGenerateCommitMessage}
      />
    ));

    await fireEvent.click(screen.getByRole('button', { name: 'Commit or push' }));

    expect(screen.getByRole('dialog', { name: 'Commit or push changes' })).toBeTruthy();
    expect(onGenerateCommitMessage).toHaveBeenCalledTimes(1);
  });

  it('dispatches toolbar refresh, stage-all, revert-all, and dirty PR ship intent', async () => {
    const onRefresh = vi.fn();
    const onStageAll = vi.fn();
    const onRevertAll = vi.fn();
    const onGenerateCommitMessage = vi.fn();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(() => (
      <DiffPanel
        visible={true}
        data={{ ...makeResult(), files: [makeFile('src/first.ts')] }}
        loading={false}
        error={null}
        hasWorkspace={true}
        reviewData={makeReviewResult()}
        selectedReviewPath="src/first.ts"
        onRefresh={onRefresh}
        onStageAll={onStageAll}
        onRevertAll={onRevertAll}
        onGenerateCommitMessage={onGenerateCommitMessage}
      />
    ));

    const commitOrPushButton = screen.getByRole('button', { name: 'Commit or push' });
    const createPrButton = screen.getByRole('button', { name: 'Create PR' });
    expect(commitOrPushButton.textContent).toBe('');
    expect(createPrButton.textContent).toBe('');
    await fireEvent.click(screen.getByRole('button', { name: 'Refresh review' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Stage all changes' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Revert all changes' }));
    await fireEvent.click(createPrButton);

    expect(onRefresh).toHaveBeenCalled();
    expect(onStageAll).toHaveBeenCalled();
    expect(onRevertAll).toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Commit or push changes' })).toBeTruthy();
    expect(onGenerateCommitMessage).toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it('uses compact diff summary counts so the narrow header does not collide', () => {
    const reviewData = makeReviewResult();
    render(() => (
      <DiffPanel
        visible={true}
        data={{ ...makeResult(), files: [makeFile('src/first.ts')] }}
        loading={false}
        error={null}
        hasWorkspace={true}
        reviewData={{
          ...reviewData,
          summary: {
            ...reviewData.summary,
            insertions: 25718,
            deletions: 541,
          },
        }}
        selectedReviewPath="src/first.ts"
      />
    ));

    const insertions = screen.getByText('+25.7k');
    const deletions = screen.getByText('−541');
    expect(insertions.getAttribute('title')).toBe('+25718');
    expect(deletions.getAttribute('title')).toBe('−541');
  });

  it('opens an existing PR directly from the toolbar', async () => {
    const onOpenPrUrl = vi.fn();

    render(() => (
      <DiffPanel
        visible={true}
        data={{ ...makeResult(), files: [makeFile('src/first.ts')] }}
        loading={false}
        error={null}
        hasWorkspace={true}
        reviewData={makeReviewResult()}
        selectedReviewPath="src/first.ts"
        shipInfo={{
          current_branch: 'feature/review',
          default_branch: 'main',
          pr_url: 'https://github.com/me/repo/pull/8',
          gh_available: true,
          can_create_pr: true,
        }}
        onOpenPrUrl={onOpenPrUrl}
      />
    ));

    await fireEvent.click(screen.getByRole('button', { name: 'Open PR' }));

    expect(onOpenPrUrl).toHaveBeenCalledWith('https://github.com/me/repo/pull/8');
  });

  it('hides ship controls and shows a terse clean state when review has no changed files', () => {
    render(() => (
      <DiffPanel
        visible={true}
        data={null}
        loading={false}
        error={null}
        hasWorkspace={true}
        reviewData={makeCleanReviewResult()}
        selectedReviewPath={null}
        commitMessageError="No changes to summarize."
      />
    ));

    expect(screen.getByText('No diffs')).toBeTruthy();
    expect(screen.getByText('Working tree clean')).toBeTruthy();
    expect(screen.queryByLabelText('Commit message')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Generate' })).toBeNull();
    expect(screen.queryByText('No changes to summarize.')).toBeNull();
  });

  it('shows an Install Command Line Tools button only for actionable errors', async () => {
    const onInstallAction = vi.fn();

    // Non-actionable error: no install button.
    const { unmount } = render(() => (
      <DiffPanel
        visible={true}
        data={null}
        loading={false}
        error="git push failed: permission denied"
        hasWorkspace={true}
        showInstallAction={false}
        onInstallAction={onInstallAction}
      />
    ));
    expect(screen.getByText('git push failed: permission denied')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Install Command Line Tools/ })).toBeNull();
    unmount();

    // Actionable error (e.g. MACOS_DEVELOPER_TOOLS_MISSING): install button present and fires.
    render(() => (
      <DiffPanel
        visible={true}
        data={null}
        loading={false}
        error="macOS Command Line Tools are missing or misconfigured."
        hasWorkspace={true}
        showInstallAction={true}
        onInstallAction={onInstallAction}
      />
    ));
    const button = screen.getByRole('button', { name: /Install Command Line Tools/ });
    expect(button).toBeTruthy();
    await fireEvent.click(button);
    expect(onInstallAction).toHaveBeenCalled();
  });

  it('renders a Retry button and surfaces loading state for install/retry', async () => {
    const onRetryAction = vi.fn();
    const onInstallAction = vi.fn();

    const { unmount } = render(() => (
      <DiffPanel
        visible={true}
        data={null}
        loading={false}
        error="macOS Command Line Tools are missing or misconfigured."
        hasWorkspace={true}
        showInstallAction={true}
        onInstallAction={onInstallAction}
        retryActionBusy={false}
        onRetryAction={onRetryAction}
      />
    ));

    // Both actions present; Retry fires its handler.
    const retryButton = screen.getByRole('button', { name: /Retry/ });
    await fireEvent.click(retryButton);
    expect(onRetryAction).toHaveBeenCalled();
    unmount();

    // Install button disabled while a retry is in flight.
    render(() => (
      <DiffPanel
        visible={true}
        data={null}
        loading={false}
        error="macOS Command Line Tools are missing or misconfigured."
        hasWorkspace={true}
        showInstallAction={true}
        onInstallAction={onInstallAction}
        retryActionBusy={true}
        onRetryAction={onRetryAction}
      />
    ));
    const installButton = screen.getByRole('button', { name: /Install Command Line Tools/ });
    expect((installButton as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows action status in a collapsible panel without hiding the diff', () => {
    const onOpenPrUrl = vi.fn();
    render(() => (
      <DiffPanel
        visible={true}
        data={{ ...makeResult(), files: [makeFile('src/app.ts')] }}
        loading={false}
        error={null}
        hasWorkspace={true}
        reviewData={makeReviewResult()}
        selectedReviewPath="src/first.ts"
        actionLog={[
          { id: 1, kind: 'stage', status: 'success', message: 'Staged src/app.ts', at: 1 },
          { id: 2, kind: 'push', status: 'failed', message: 'Push failed: permission denied', at: 2 },
        ]}
        createdPrUrl="https://github.com/me/repo/pull/7"
        onOpenPrUrl={onOpenPrUrl}
      />
    ));

    // The diff body is NOT replaced — review panel stays visible.
    expect(screen.getByText('Staged')).toBeTruthy();
    // Collapsed panel summarizes the last action (the failure).
    expect(screen.getByText(/Push failed: permission denied/)).toBeTruthy();
    // Expanding reveals the history + PR link.
    fireEvent.click(screen.getByRole('button', { name: /Push failed/ }));
    const link = screen.getByText(/open https:\/\/github\.com\/me\/repo\/pull\/7/);
    fireEvent.click(link);
    expect(onOpenPrUrl).toHaveBeenCalledWith('https://github.com/me/repo/pull/7');
  });

  it('disables the PR button with a tooltip when on the default branch', () => {
    render(() => (
      <DiffPanel
        visible={true}
        data={makeResult()}
        loading={false}
        error={null}
        hasWorkspace={true}
        reviewData={makeReviewResult()}
        prDisabled={true}
        prDisabledReason="Switch to a feature branch to create a PR."
      />
    ));
    const prButton = screen.getByRole('button', { name: 'Create PR' });
    expect((prButton as HTMLButtonElement).disabled).toBe(true);
    expect(prButton.getAttribute('title')).toContain('feature branch');
  });

  it('falls back to the drawer when the Review body cannot fit the split', () => {
    mockReviewBodyWidth(620);
    render(() => (
      <DiffPanel
        visible={true}
        data={makeResult()}
        loading={false}
        error={null}
        hasWorkspace={true}
        activeFileIndex={0}
      />
    ));

    expect(screen.queryByRole('separator', { name: 'Resize changed files pane' })).toBeNull();
    expect(screen.getByRole('button', { name: /Open changed files/ })).toBeTruthy();
  });

  it('resizes the Review file rail by dragging the splitter and clamps to bounds', async () => {
    mockReviewBodyWidth(960);
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const onReviewFileRailWidthChange = vi.fn();

    render(() => (
      <DiffPanel
        visible={true}
        data={makeResult()}
        loading={false}
        error={null}
        hasWorkspace={true}
        activeFileIndex={0}
        reviewFileRailWidth={304}
        onReviewFileRailWidthChange={onReviewFileRailWidthChange}
      />
    ));

    const handle = screen.getByRole('separator', { name: 'Resize changed files pane' });
    await fireEvent.mouseDown(handle, { clientX: 500, button: 0 });
    await fireEvent.mouseMove(document, { clientX: 120 });
    await fireEvent.mouseUp(document);

    expect(onReviewFileRailWidthChange).toHaveBeenCalledWith(400);
  });

  it('keeps the preferred split width when a temporary narrow clamp relaxes', () => {
    mockReviewBodyWidth(780);
    const [railWidth, setRailWidth] = createSignal(400);
    const { unmount } = render(() => (
      <DiffPanel
        visible={true}
        data={makeResult()}
        loading={false}
        error={null}
        hasWorkspace={true}
        activeFileIndex={0}
        reviewFileRailWidth={railWidth()}
        onReviewFileRailWidthChange={setRailWidth}
      />
    ));

    expect(screen.getByTestId('diff-panel').style.getPropertyValue('--review-file-rail-width')).toBe('316px');
    expect(railWidth()).toBe(400);
    unmount();

    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    mockReviewBodyWidth(960);
    render(() => (
      <DiffPanel
        visible={true}
        data={makeResult()}
        loading={false}
        error={null}
        hasWorkspace={true}
        activeFileIndex={0}
        reviewFileRailWidth={railWidth()}
        onReviewFileRailWidthChange={setRailWidth}
      />
    ));

    expect(screen.getByTestId('diff-panel').style.getPropertyValue('--review-file-rail-width')).toBe('400px');
  });

  it('supports keyboard resizing and reset on the Review splitter', async () => {
    mockReviewBodyWidth(960);
    const [railWidth, setRailWidth] = createSignal(304);

    render(() => (
      <DiffPanel
        visible={true}
        data={makeResult()}
        loading={false}
        error={null}
        hasWorkspace={true}
        activeFileIndex={0}
        reviewFileRailWidth={railWidth()}
        onReviewFileRailWidthChange={setRailWidth}
        onResetReviewFileRailWidth={() => setRailWidth(304)}
      />
    ));

    const handle = screen.getByRole('separator', { name: 'Resize changed files pane' });
    await fireEvent.keyDown(handle, { key: 'ArrowLeft' });
    expect(railWidth()).toBe(328);
    await fireEvent.keyDown(handle, { key: 'ArrowRight' });
    expect(railWidth()).toBe(304);
    await fireEvent.keyDown(handle, { key: 'End' });
    expect(railWidth()).toBe(400);
    await fireEvent.keyDown(handle, { key: 'Home' });
    expect(railWidth()).toBe(248);
    await fireEvent.keyDown(handle, { key: 'Enter' });
    expect(railWidth()).toBe(304);
  });

  it('offsets the ship popover away from the split file rail', async () => {
    mockReviewBodyWidth(960);
    render(() => (
      <DiffPanel
        visible={true}
        data={{ ...makeResult(), files: [makeFile('src/new.ts', 'added')] }}
        loading={false}
        error={null}
        hasWorkspace={true}
        reviewData={makeReviewResult()}
        selectedReviewPath="src/new.ts"
        commitMessage="feat: add review"
        reviewFileRailWidth={360}
      />
    ));

    await fireEvent.click(screen.getByRole('button', { name: 'Commit or push' }));

    expect(screen.getByRole('dialog', { name: 'Commit or push changes' })).toBeTruthy();
    expect(screen.getByTestId('diff-panel').style.getPropertyValue('--review-ship-popover-right')).toBe('380px');
  });
});
