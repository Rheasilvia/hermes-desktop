import { fireEvent, render, screen } from '@solidjs/testing-library';
import { describe, expect, test, vi } from 'vitest';
import { QueuedPromptDock } from '../QueuedPromptDock.js';
import type { QueuedPromptEntry } from '@/stores/composer-queue.js';

function queuedEntry(overrides: Partial<QueuedPromptEntry>): QueuedPromptEntry {
  return {
    id: 'queued-1',
    text: 'Review this change',
    attachments: [],
    queuedAt: 1,
    ...overrides,
  };
}

describe('QueuedPromptDock', () => {
  test('renders queued message content, count, status, and attachment summary', () => {
    render(() => (
      <QueuedPromptDock
        entries={[
          queuedEntry({
            id: 'queued-1',
            text: 'Review this change\nand then run tests',
            attachments: [
              { id: 'file-a', kind: 'file', name: 'a.ts', path: '/repo/a.ts' },
              { id: 'folder-src', kind: 'folder', name: 'src', path: '/repo/src' },
              { id: 'image-ui', kind: 'image', name: 'ui.png', path: '/tmp/ui.png' },
              { id: 'url-docs', kind: 'url', name: 'docs', path: 'https://example.com' },
            ],
          }),
          queuedEntry({ id: 'queued-2', text: 'Ship the follow-up' }),
        ]}
        onRemove={vi.fn()}
        canSteerFirst
        onSteerFirst={vi.fn()}
      />
    ));

    expect(screen.getByLabelText('Queued follow-up messages')).toBeTruthy();
    expect(screen.getByText('Queued follow-up')).toBeTruthy();
    expect(screen.getByText('2')).toBeTruthy();
    expect(screen.getByText('Sends after current turn')).toBeTruthy();
    expect(screen.getByText(/Review this change/)).toBeTruthy();
    expect(screen.getByText('4 attachments')).toBeTruthy();
    expect(screen.getByText('a.ts')).toBeTruthy();
    expect(screen.getByText('src')).toBeTruthy();
    expect(screen.getByText('ui.png')).toBeTruthy();
    expect(screen.getByText('+1')).toBeTruthy();
    expect(screen.getAllByTestId('queued-prompt-item')).toHaveLength(2);
  });

  test('calls the Steer action for the first queued item from the header', () => {
    const onSteerFirst = vi.fn();
    render(() => (
      <QueuedPromptDock
        entries={[queuedEntry({ id: 'queued-1', text: 'Nudge the run' })]}
        onRemove={vi.fn()}
        canSteerFirst
        onSteerFirst={onSteerFirst}
      />
    ));

    fireEvent.click(screen.getByRole('button', { name: 'Steer first queued follow-up' }));

    expect(onSteerFirst).toHaveBeenCalledTimes(1);
  });

  test('disables the Steer action with the provided reason', () => {
    render(() => (
      <QueuedPromptDock
        entries={[queuedEntry({ id: 'queued-1', text: 'Nudge the run' })]}
        onRemove={vi.fn()}
        canSteerFirst={false}
        steerDisabledReason="Queued follow-ups with attachments stay queued for the next turn."
        onSteerFirst={vi.fn()}
      />
    ));

    const steer = screen.getByRole('button', { name: 'Steer first queued follow-up' }) as HTMLButtonElement;
    expect(steer.disabled).toBe(true);
    expect(steer.title).toBe('Queued follow-ups with attachments stay queued for the next turn.');
  });

  test('renders an inline steer warning inside the queued panel', () => {
    render(() => (
      <QueuedPromptDock
        entries={[queuedEntry({ id: 'queued-1', text: 'Nudge the run' })]}
        onRemove={vi.fn()}
        warning="Steer unavailable; still queued for next turn."
      />
    ));

    expect(screen.getByRole('status').textContent).toBe('Steer unavailable; still queued for next turn.');
  });

  test('renders an attachment-only fallback and removes the selected item', () => {
    const onRemove = vi.fn();
    render(() => (
      <QueuedPromptDock
        entries={[
          queuedEntry({
            id: 'queued-empty',
            text: '',
            attachments: [{ id: 'file-a', kind: 'file', name: 'a.ts', path: '/repo/a.ts' }],
          }),
        ]}
        onRemove={onRemove}
      />
    ));

    expect(screen.getByText('Attachment-only message')).toBeTruthy();
    expect(screen.getByText('1 attachment')).toBeTruthy();

    fireEvent.click(screen.getByLabelText('Remove queued message'));

    expect(onRemove).toHaveBeenCalledWith('queued-empty');
  });
});
