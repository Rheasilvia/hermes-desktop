import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mirrors the literal key in usage.ts (kept module-private there, like ui.ts).
const STORAGE_KEY = 'hermes-desktop-session-usage';

const EMPTY = {
  contextUsed: null,
  contextMax: null,
  contextPercent: null,
  costUsd: null,
  totalTokens: null,
};

describe('sessionUsage persistence', () => {
  beforeEach(() => {
    localStorage.clear();
    // The store reads localStorage once at module init, so re-import per test.
    vi.resetModules();
  });

  it('rehydrates persisted usage at init (restart no longer resets to 0)', async () => {
    const saved = {
      sess_a: {
        contextUsed: 8400,
        contextMax: 200000,
        contextPercent: 4.2,
        costUsd: 0.42,
        totalTokens: 1234,
      },
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));

    const { sessionUsage } = await import('../usage.js');
    expect(sessionUsage.get('sess_a')).toEqual(saved.sess_a);
  });

  it('persists usage to localStorage on update', async () => {
    const { sessionUsage } = await import('../usage.js');
    sessionUsage.update('sess_b', {
      context_used: 8400,
      context_max: 200000,
      context_percent: 4.2,
      cost_usd: 0.42,
      total: 1234,
    });

    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    expect(stored.sess_b).toEqual({
      contextUsed: 8400,
      contextMax: 200000,
      contextPercent: 4.2,
      costUsd: 0.42,
      totalTokens: 1234,
    });
  });

  it('persists the cleared state on reset', async () => {
    const { sessionUsage } = await import('../usage.js');
    sessionUsage.update('sess_c', { total: 999 });
    sessionUsage.reset('sess_c');

    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    expect(stored.sess_c).toEqual(EMPTY);
  });

  it('falls back to empty usage when storage is missing or malformed', async () => {
    localStorage.setItem(STORAGE_KEY, 'not valid json{{');
    const { sessionUsage } = await import('../usage.js');
    expect(sessionUsage.get('anything')).toEqual(EMPTY);
  });

  it('ignores malformed entries but keeps well-formed ones', async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        good: {
          contextUsed: 10,
          contextMax: 100,
          contextPercent: 10,
          costUsd: 0.01,
          totalTokens: 50,
        },
        bad: 12345, // not an object
      }),
    );

    const { sessionUsage } = await import('../usage.js');
    expect(sessionUsage.get('good')).toEqual({
      contextUsed: 10,
      contextMax: 100,
      contextPercent: 10,
      costUsd: 0.01,
      totalTokens: 50,
    });
    // Malformed entry must not reach consumers as junk; treated as empty.
    expect(sessionUsage.get('bad')).toEqual(EMPTY);
  });
});
