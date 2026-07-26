import { describe, expect, it, vi, beforeEach } from 'vitest';
import { toastStore } from '../toast.js';

describe('toastStore', () => {
  beforeEach(() => {
    toastStore.resetForTests();
  });

  it('pushes and lists toasts with stable incremental ids', () => {
    const id1 = toastStore.success('saved');
    const id2 = toastStore.error('failed');

    expect(toastStore.list.map((t) => t.id)).toEqual([id1, id2]);
    expect(id2).toBe(id1 + 1);
    expect(toastStore.list[0]).toMatchObject({ type: 'success', message: 'saved' });
    expect(toastStore.list[1]).toMatchObject({ type: 'error', message: 'failed' });
  });

  it('dismisses by id', () => {
    const id = toastStore.info('hi');
    toastStore.dismiss(id);
    expect(toastStore.list).toHaveLength(0);
  });

  it('auto-dismisses after the duration', () => {
    vi.useFakeTimers();
    toastStore.push({ message: 'gone soon', type: 'info', duration: 1000 });
    expect(toastStore.list).toHaveLength(1);
    vi.advanceTimersByTime(1000);
    expect(toastStore.list).toHaveLength(0);
    vi.useRealTimers();
  });

  it('keeps toasts with duration 0 until manually dismissed', () => {
    vi.useFakeTimers();
    toastStore.push({ message: 'persistent', type: 'info', duration: 0 });
    vi.advanceTimersByTime(60_000);
    expect(toastStore.list).toHaveLength(1);
    toastStore.dismiss(toastStore.list[0].id);
    expect(toastStore.list).toHaveLength(0);
    vi.useRealTimers();
  });

  it('carries an optional action', () => {
    const action = vi.fn();
    toastStore.success('PR created', { label: 'Open', onClick: action });
    expect(toastStore.list[0].action).toEqual({ label: 'Open', onClick: action });
  });
});
