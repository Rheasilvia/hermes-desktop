import { fireEvent, render, screen } from '@solidjs/testing-library';
import { describe, expect, test, vi } from 'vitest';

import type { TodoItem } from '@/types/gateway.js';

import { TodoPanel } from '../TodoPanel.js';

const makeTodos = (): TodoItem[] => [
  { id: 'write', content: 'Write implementation', status: 'completed' },
  { id: 'test', content: 'Add regression tests', status: 'in_progress' },
  { id: 'verify', content: 'Run verification', status: 'pending' },
];

describe('TodoPanel', () => {
  test('collapsed state shows counts without task titles', () => {
    render(() => <TodoPanel todos={makeTodos()} />);

    expect(screen.getByText('Tasks')).toBeDefined();
    expect(screen.getByText('1/3')).toBeDefined();
    expect(screen.getByText('1 active')).toBeDefined();
    expect(screen.queryByText('Write implementation')).toBeNull();
    expect(screen.queryByRole('list')).toBeNull();
  });

  test('expands the popup task list on click', () => {
    render(() => <TodoPanel todos={makeTodos()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Show task list' }));

    expect(screen.getByRole('button', { name: 'Hide task list' })).toBeDefined();
    expect(screen.getByRole('list')).toBeDefined();
    expect(screen.getByText('Write implementation')).toBeDefined();
    expect(screen.getByText('Add regression tests')).toBeDefined();
  });

  test('expands the popup task list from keyboard activation', () => {
    render(() => <TodoPanel todos={makeTodos()} />);

    fireEvent.keyDown(screen.getByRole('button', { name: 'Show task list' }), { key: 'Enter' });

    expect(screen.getByRole('list')).toBeDefined();
  });

  test('pause and close actions do not toggle the popup', () => {
    const onPause = vi.fn();
    const onClose = vi.fn();
    render(() => <TodoPanel todos={makeTodos()} isStreaming onPause={onPause} onClose={onClose} />);

    fireEvent.click(screen.getByRole('button', { name: 'Pause chat' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close task panel' }));

    expect(onPause).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('list')).toBeNull();
  });
});
