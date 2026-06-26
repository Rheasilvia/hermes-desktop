import { fireEvent, render, screen, within } from '@solidjs/testing-library';
import { describe, expect, it, vi } from 'vitest';
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

describe('DiffPanel', () => {
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
    expect(screen.getByRole('listbox', { name: 'Changed files' })).toBeTruthy();
    expect(screen.getAllByTestId('diff-file-row').length).toBeLessThan(40);
    expect(screen.getAllByText('first.ts').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'second.ts' })).toBeNull();
    expect(onSelectFile).not.toHaveBeenCalled();
  });

  it('opens a searchable file drawer in narrow mode and selects the original file index', async () => {
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

    await fireEvent.click(screen.getByRole('button', { name: /Open changed files/ }));
    const dialog = screen.getByRole('dialog', { name: 'Changed files' });
    const drawer = within(dialog);
    await fireEvent.input(drawer.getByPlaceholderText('Search files'), {
      target: { value: 'second' },
    });
    await fireEvent.click(drawer.getByRole('option', { name: /second\.ts/ }));

    expect(onSelectFile).toHaveBeenCalledWith(1);
    expect(screen.queryByRole('dialog', { name: 'Changed files' })).toBeNull();
  });

  it('closes the file drawer with Escape and outside pointer down', async () => {
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

    expect(screen.getByText('Review')).toBeTruthy();
    expect(screen.getByText('+6')).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: 'Stage' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Revert' }));
    await fireEvent.click(screen.getByRole('button', { name: /Open changed files/ }));
    await fireEvent.click(within(screen.getByRole('dialog', { name: 'Changed files' })).getByRole('option', { name: /new\.ts/ }));

    expect(onStageFile).toHaveBeenCalledWith('src/first.ts');
    expect(onRevertFile).toHaveBeenCalledWith('src/first.ts');
    expect(onSelectReviewFile).toHaveBeenCalledWith('src/new.ts');
    expect(onUnstageFile).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it('surfaces commit controls and preserves failures inside the panel', async () => {
    const onCommitMessageChange = vi.fn();
    const onGenerateCommitMessage = vi.fn();
    const onCancelGenerateCommitMessage = vi.fn();
    const onCommit = vi.fn();
    const onPush = vi.fn();
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
        commitMessageError="COMMIT_MESSAGE_PROVIDER_UNAVAILABLE"
        onCommitMessageChange={onCommitMessageChange}
        onGenerateCommitMessage={onGenerateCommitMessage}
        onCancelGenerateCommitMessage={onCancelGenerateCommitMessage}
        onCommit={onCommit}
        onPush={onPush}
        onCreatePr={onCreatePr}
      />
    ));

    await fireEvent.input(screen.getByLabelText('Commit message'), {
      target: { value: 'fix: changed' },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Generate' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Commit' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Push' }));
    await fireEvent.click(screen.getByRole('button', { name: 'PR' }));

    expect(onCommitMessageChange).toHaveBeenCalledWith('fix: changed');
    expect(onGenerateCommitMessage).toHaveBeenCalled();
    expect(onCancelGenerateCommitMessage).not.toHaveBeenCalled();
    expect(onCommit).toHaveBeenCalledWith('feat: add review');
    expect(onPush).toHaveBeenCalled();
    expect(onCreatePr).toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toContain('COMMIT_MESSAGE_PROVIDER_UNAVAILABLE');
  });
});
