import { fireEvent, render, screen, within } from '@solidjs/testing-library';
import { describe, expect, it, vi } from 'vitest';
import type { DiffFile, FileStatus, GitDiffResult } from '@/types/diff.js';
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
});
