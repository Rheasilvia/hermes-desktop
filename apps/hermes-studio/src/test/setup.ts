import { cleanup } from '@solidjs/testing-library';
import { afterEach, vi } from 'vitest';

/**
 * Global test setup for Vitest unit tests.
 * Runs before each test file.
 */

// Mock localStorage for tests that use it
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string): string | null => store[key] ?? null,
    setItem: (key: string, value: string): void => {
      store[key] = value;
    },
    removeItem: (key: string): void => {
      delete store[key];
    },
    clear: (): void => {
      store = {};
    },
    get length(): number {
      return Object.keys(store).length;
    },
    key: (index: number): string | null => {
      const keys = Object.keys(store);
      return keys[index] ?? null;
    },
  };
})();
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock });

// Clean up after each test
afterEach(() => {
  cleanup();
});
