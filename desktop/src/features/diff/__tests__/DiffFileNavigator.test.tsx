import { fireEvent, render, screen } from '@solidjs/testing-library';
import { describe, expect, it, vi } from 'vitest';
import type { DiffFile, FileStatus } from '@/types/diff.js';
import { DiffFileNavigator } from '../DiffFileNavigator.js';
import { buildDiffFileRows } from '../diff-file-navigator-model.js';

const makeFile = (path: string, status: FileStatus, additions = 1, deletions = 0): DiffFile => ({
  path,
  old_path: null,
  status,
  hunks: [
    {
      header: '@@ -1,3 +1,3 @@',
      old_start: 1,
      old_count: additions + deletions,
      new_start: 1,
      new_count: additions + deletions,
      lines: [
        ...Array.from({ length: additions }, (_, index) => ({
          kind: 'addition' as const,
          old_lineno: null,
          new_lineno: index + 1,
          content: `${path} added ${index}`,
        })),
        ...Array.from({ length: deletions }, (_, index) => ({
          kind: 'deletion' as const,
          old_lineno: index + 1,
          new_lineno: null,
          content: `${path} deleted ${index}`,
        })),
      ],
    },
  ],
});

const makeRows = () =>
  buildDiffFileRows([
    makeFile('src/components/Button.tsx', 'modified', 2, 1),
    makeFile('src/components/Card.tsx', 'added', 1, 0),
    makeFile('docs/guide.md', 'deleted', 0, 2),
    ...Array.from({ length: 80 }, (_, index) =>
      makeFile(`src/generated/file-${index}.ts`, 'modified', 1, 0),
    ),
  ]);

describe('DiffFileNavigator', () => {
  it('virtualizes large changed-file lists', () => {
    render(() => (
      <DiffFileNavigator
        rows={makeRows()}
        activeIndex={0}
        ariaLabel="Changed files"
        onSelect={vi.fn()}
      />
    ));

    expect(screen.getByRole('listbox', { name: 'Changed files' })).toBeTruthy();
    expect(screen.getAllByTestId('diff-file-row').length).toBeLessThan(40);
    expect(screen.queryByText('file-79.ts')).toBeNull();
  });

  it('starts the virtual list around the active file when it is deep in the change set', () => {
    render(() => (
      <DiffFileNavigator
        rows={makeRows()}
        activeIndex={70}
        ariaLabel="Changed files"
        onSelect={vi.fn()}
      />
    ));

    expect(screen.getByRole('option', { name: /file-67\.ts/ })).toBeTruthy();
    expect(screen.queryByRole('option', { name: /Button\.tsx/ })).toBeNull();
  });

  it('searches paths and selects the original file index', async () => {
    const onSelect = vi.fn();
    render(() => (
      <DiffFileNavigator
        rows={makeRows()}
        activeIndex={0}
        ariaLabel="Changed files"
        onSelect={onSelect}
      />
    ));

    await fireEvent.input(screen.getByPlaceholderText('Search files'), {
      target: { value: 'guide' },
    });
    await fireEvent.click(screen.getByRole('option', { name: /guide\.md/ }));

    expect(onSelect).toHaveBeenCalledWith(2);
  });

  it('filters by status while preserving the original file index', async () => {
    const onSelect = vi.fn();
    render(() => (
      <DiffFileNavigator
        rows={makeRows()}
        activeIndex={0}
        ariaLabel="Changed files"
        onSelect={onSelect}
      />
    ));

    await fireEvent.click(screen.getByRole('button', { name: 'Show Added files' }));
    expect(screen.getByRole('option', { name: /Card\.tsx/ })).toBeTruthy();
    expect(screen.queryByRole('option', { name: /Button\.tsx/ })).toBeNull();

    await fireEvent.click(screen.getByRole('option', { name: /Card\.tsx/ }));
    expect(onSelect).toHaveBeenCalledWith(1);
  });

  it('supports keyboard navigation through the filtered list', async () => {
    const onSelect = vi.fn();
    render(() => (
      <DiffFileNavigator
        rows={makeRows()}
        activeIndex={0}
        ariaLabel="Changed files"
        onSelect={onSelect}
      />
    ));

    const listbox = screen.getByRole('listbox', { name: 'Changed files' });
    listbox.focus();
    await fireEvent.keyDown(listbox, { key: 'ArrowDown' });
    await fireEvent.keyDown(listbox, { key: 'Enter' });

    expect(onSelect).toHaveBeenCalledWith(1);
  });
});
