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

  it('clones attachments so queued entries are not mutated by caller state', () => {
    const attachments = [{ name: 'a.txt', path: '/tmp/a.txt', size: 1 }];
    const entry = composerQueueStore.enqueue('sess_a', { text: 'inspect', attachments });
    attachments[0].name = 'changed.txt';

    expect(entry?.attachments[0].name).toBe('a.txt');
    expect(composerQueueStore.getQueuedPrompts('sess_a')[0].attachments[0].name).toBe('a.txt');
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
