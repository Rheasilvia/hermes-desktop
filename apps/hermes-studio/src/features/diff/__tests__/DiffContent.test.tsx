import { fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import type { DiffFile } from '@/types/diff.js';
import { DiffContent } from '../DiffContent.js';

const makeFile = (path: string, lineCount: number): DiffFile => ({
  path,
  old_path: null,
  status: 'modified',
  hunks: [
    {
      header: '@@ -1,3 +1,3 @@',
      old_start: 1,
      old_count: lineCount,
      new_start: 1,
      new_count: lineCount,
      lines: Array.from({ length: lineCount }, (_, index) => ({
        kind: index % 3 === 0 ? 'addition' : index % 3 === 1 ? 'deletion' : 'context',
        old_lineno: index % 3 === 0 ? null : index + 1,
        new_lineno: index % 3 === 1 ? null : index + 1,
        content: `${path} line ${index}`,
      })),
    },
  ],
});

describe('DiffContent virtualization', () => {
  it('renders only visible diff lines for a large active file', () => {
    render(() => (
      <DiffContent
        files={[makeFile('src/large.ts', 1000), makeFile('src/other.ts', 5)]}
        activeIndex={0}
        onSelectFile={vi.fn()}
      />
    ));

    expect(screen.getAllByTestId('diff-virtual-line').length).toBeLessThan(80);
    expect(screen.queryByText('src/large.ts line 999')).toBeNull();
    expect(screen.getByTestId('diff-virtual-surface').style.minWidth).toContain('ch');
  });

  it('updates visible rows when the diff viewport scrolls', async () => {
    render(() => (
      <DiffContent
        files={[makeFile('src/scroll.ts', 300)]}
        activeIndex={0}
        onSelectFile={vi.fn()}
      />
    ));

    const viewport = screen.getByTestId('diff-virtual-viewport') as HTMLDivElement;
    viewport.scrollTop = 3000;
    await fireEvent.scroll(viewport);

    expect(screen.queryByText('src/scroll.ts line 0')).toBeNull();
    expect(screen.getByText('src/scroll.ts line 150')).toBeTruthy();
  });

  it('resets scroll and row model when the active file changes', async () => {
    const [activeIndex, setActiveIndex] = createSignal(0);
    render(() => (
      <DiffContent
        files={[makeFile('src/first.ts', 300), makeFile('src/second.ts', 20)]}
        activeIndex={activeIndex()}
        onSelectFile={setActiveIndex}
      />
    ));

    const viewport = screen.getByTestId('diff-virtual-viewport') as HTMLDivElement;
    viewport.scrollTop = 3000;
    await fireEvent.scroll(viewport);
    expect(screen.getByText('src/first.ts line 150')).toBeTruthy();

    setActiveIndex(1);

    await waitFor(() => {
      expect(viewport.scrollTop).toBe(0);
      expect(screen.getByText('src/second.ts')).toBeTruthy();
      expect(screen.getByText('src/second.ts line 0')).toBeTruthy();
    });
    expect(screen.queryByText('src/first.ts line 150')).toBeNull();
  });
});
