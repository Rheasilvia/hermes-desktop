import { describe, expect, it, vi } from 'vitest';
import {
  MODEL_CACHE_STORAGE_KEYS,
  STORAGE_KEYS,
  clearModelCacheEntries,
} from '../storage-keys.js';

describe('Hermes Studio storage keys', () => {
  it('uses one unique hermes.studio namespace for every persisted value', () => {
    const keys = Object.values(STORAGE_KEYS);

    expect(keys.every((key) => key.startsWith('hermes.studio.'))).toBe(true);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('clears only current Hermes Studio model caches', () => {
    const removeItem = vi.fn();

    clearModelCacheEntries({ removeItem });

    expect(removeItem.mock.calls.map(([key]) => key)).toEqual(MODEL_CACHE_STORAGE_KEYS);
    expect(MODEL_CACHE_STORAGE_KEYS).toEqual([
      STORAGE_KEYS.modelCatalog,
      STORAGE_KEYS.modelProviders,
    ]);
  });
});
