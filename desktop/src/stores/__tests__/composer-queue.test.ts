import { beforeEach, describe, expect, it } from 'vitest';
import { composerQueueStore, shouldAutoDrainOnSettle } from '../composer-queue.js';

describe('composerQueueStore', () => {
  beforeEach(() => {
    window.localStorage.clear();
    composerQueueStore.clearAll();
  });

  it('keeps queued prompts isolated per session', () => {
    composerQueueStore.enqueue('sess_a', { text: 'first' });
    composerQueueStore.enqueue('sess_b', { text: 'second' });

    expect(composerQueueStore.getQueuedPrompts('sess_a').map((entry) => entry.text)).toEqual(['first']);
    expect(composerQueueStore.getQueuedPrompts('sess_b').map((entry) => entry.text)).toEqual(['second']);
  });

  it('dequeues prompts in FIFO order and removes empty sessions', () => {
    composerQueueStore.enqueue('sess_a', { text: 'first' });
    composerQueueStore.enqueue('sess_a', { text: 'second' });

    expect(composerQueueStore.dequeue('sess_a')?.text).toBe('first');
    expect(composerQueueStore.dequeue('sess_a')?.text).toBe('second');
    expect(composerQueueStore.dequeue('sess_a')).toBeNull();
    expect(composerQueueStore.getQueuedPrompts('sess_a')).toEqual([]);
  });

  it('removes one queued prompt while preserving FIFO order', () => {
    const first = composerQueueStore.enqueue('sess_a', { text: 'first' });
    const second = composerQueueStore.enqueue('sess_a', { text: 'second' });
    const third = composerQueueStore.enqueue('sess_a', { text: 'third' });

    expect(composerQueueStore.remove('sess_a', second?.id)?.text).toBe('second');
    expect(composerQueueStore.getQueuedPrompts('sess_a').map((entry) => entry.text)).toEqual(['first', 'third']);
    const persisted = JSON.parse(window.localStorage.getItem('hermes.tauri.composerQueue.v1') ?? '{}') as { sess_a?: Array<{ text: string }> };
    expect(persisted.sess_a?.map((entry) => entry.text)).toEqual(['first', 'third']);
    expect(composerQueueStore.dequeue('sess_a')?.id).toBe(first?.id);
    expect(composerQueueStore.dequeue('sess_a')?.id).toBe(third?.id);
  });

  it('returns null when removing a missing queued prompt', () => {
    composerQueueStore.enqueue('sess_a', { text: 'first' });

    expect(composerQueueStore.remove('sess_a', 'missing')).toBeNull();
    expect(composerQueueStore.remove('missing-session', 'missing')).toBeNull();
    expect(composerQueueStore.remove('sess_a', null)).toBeNull();
    expect(composerQueueStore.getQueuedPrompts('sess_a').map((entry) => entry.text)).toEqual(['first']);
  });

  it('clones attachments so queued entries are not mutated by caller state', () => {
    const attachments = [{ id: 'file:/tmp/a.txt', kind: 'file' as const, name: 'a.txt', path: '/tmp/a.txt', refText: '@file:/tmp/a.txt', size: 1 }];
    const entry = composerQueueStore.enqueue('sess_a', { text: 'inspect', attachments });
    attachments[0].name = 'changed.txt';

    expect(entry?.attachments[0].name).toBe('a.txt');
    expect(composerQueueStore.getQueuedPrompts('sess_a')[0].attachments[0].name).toBe('a.txt');
  });

  it('persists ordered display parts with queued prompts', () => {
    const displayParts = [
      { type: 'file_ref' as const, refText: '@file:docs/a.ts', name: 'a.ts', detail: 'docs/a.ts', anchor: 'File 1' },
      { type: 'text' as const, text: ' explain this' },
    ];
    const entry = composerQueueStore.enqueue('sess_a', {
      text: '[File 1: a.ts] explain this',
      attachments: [],
      displayParts,
    });
    displayParts[0].name = 'changed.ts';

    expect(entry?.displayParts?.[0]).toMatchObject({ name: 'a.ts', refText: '@file:docs/a.ts' });
    expect(composerQueueStore.getQueuedPrompts('sess_a')[0].displayParts?.[0]).toMatchObject({
      name: 'a.ts',
      refText: '@file:docs/a.ts',
    });
  });
});

describe('shouldAutoDrainOnSettle', () => {
  it('auto drains only after a natural busy-to-idle transition with queued prompts', () => {
    expect(shouldAutoDrainOnSettle({
      wasBusy: true,
      isBusy: false,
      queueLength: 1,
      userInterrupted: false,
    })).toBe(true);
  });

  it('does not auto drain after explicit user interrupt', () => {
    expect(shouldAutoDrainOnSettle({
      wasBusy: true,
      isBusy: false,
      queueLength: 1,
      userInterrupted: true,
    })).toBe(false);
  });
});
