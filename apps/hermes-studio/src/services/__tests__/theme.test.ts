import { beforeEach, describe, expect, it, vi } from 'vitest';
import { STORAGE_KEYS } from '@/lib/storage-keys.js';

const mocks = vi.hoisted(() => ({
  loadDesktopSettings: vi.fn(),
  setTheme: vi.fn(),
}));

vi.mock('../desktop-settings.js', () => ({
  loadDesktopSettings: mocks.loadDesktopSettings,
}));

vi.mock('@/stores/ui.js', () => ({
  uiStore: { setTheme: mocks.setTheme },
}));

import { initTheme } from '../theme.js';

describe('Hermes Studio theme persistence', () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.loadDesktopSettings.mockReset().mockResolvedValue({ theme: undefined });
    mocks.setTheme.mockReset();
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })));
  });

  it('uses the Studio key and leaves the previous Desktop key untouched', async () => {
    localStorage.setItem('hermes-desktop-theme', 'light');
    localStorage.setItem(STORAGE_KEYS.theme, 'dark');

    await initTheme();

    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(mocks.setTheme).toHaveBeenCalledWith('dark');
    expect(localStorage.getItem('hermes-desktop-theme')).toBe('light');
  });
});
