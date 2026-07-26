import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const LEGACY_VALUES = {
  'hermes-desktop-theme': 'light',
  'hermes-desktop-sidebar-collapsed': 'true',
  'hermes-desktop-session-usage': JSON.stringify({ legacy: { totalTokens: 99 } }),
  'hermes.desktop.model.providers.v2': JSON.stringify([{ id: 'legacy-provider' }]),
  'hermes.desktop.model.catalog.v2': JSON.stringify([{ id: 'legacy-catalog' }]),
  'hermes.tauri.sessionPreviews.v1': JSON.stringify({ legacy: [] }),
  'hermes.tauri.sessionPreviews.v2': JSON.stringify({ legacy: [] }),
  'hermes.tauri.composerQueue.v1': JSON.stringify({ legacy: [] }),
} as const;

describe('Hermes Studio storage isolation', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
    for (const [key, value] of Object.entries(LEGACY_VALUES)) {
      localStorage.setItem(key, value);
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not read or delete keys owned by previous desktop renderers', async () => {
    const getItem = vi.spyOn(localStorage, 'getItem');
    const removeItem = vi.spyOn(localStorage, 'removeItem');

    await import('../ui.js');
    await import('../usage.js');
    await import('../models.js');
    await import('../preview.js');
    await import('../composer-queue.js');

    const legacyKeys = Object.keys(LEGACY_VALUES);
    const readKeys = getItem.mock.calls.map(([key]) => key);
    const removedKeys = removeItem.mock.calls.map(([key]) => key);
    expect(readKeys.filter((key) => legacyKeys.includes(key))).toEqual([]);
    expect(removedKeys.filter((key) => legacyKeys.includes(key))).toEqual([]);

    for (const [key, value] of Object.entries(LEGACY_VALUES)) {
      expect(localStorage.getItem(key)).toBe(value);
    }
  });
});
