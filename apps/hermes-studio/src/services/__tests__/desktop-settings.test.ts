import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import type { HermesStudioBridge } from '@/shared/native-bridge.js';
import { STORAGE_KEYS } from '@/lib/storage-keys.js';
import { installNativeHostMock } from '../native-host.js';
import {
  loadDesktopSettings,
  saveDesktopSettings,
  applyDesktopSettings,
  type DesktopSettings,
} from '../desktop-settings.js';

describe('desktop-settings', () => {
  let restoreHost: (() => void) | undefined;
  const mockSettings: DesktopSettings = {
    theme: 'dark',
    language: 'en',
    fontSize: 115,
    reducedMotion: true,
    autoSave: false,
    confirmDestructive: true,
    startupBehavior: 'new',
    showCost: false,
    showReasoning: false,
  };

  beforeEach(() => {
    restoreHost = installNativeHostMock(null);
    // Reset DOM state before each test
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.removeAttribute('data-reduced-motion');
    document.documentElement.removeAttribute('lang');
    document.documentElement.style.fontSize = '';
    // Clear localStorage to avoid cross-test leakage
    localStorage.clear();
  });

  afterEach(() => {
    restoreHost?.();
    restoreHost = undefined;
    vi.restoreAllMocks();
  });

  describe('applyDesktopSettings', () => {
    test('applies theme to html dataset', () => {
      applyDesktopSettings(mockSettings);
      expect(document.documentElement.dataset.theme).toBe('dark');
    });

    test('applies font size as percentage on html style', () => {
      applyDesktopSettings(mockSettings);
      expect(document.documentElement.style.fontSize).toBe('115%');
    });

    test('applies reduced motion when enabled', () => {
      applyDesktopSettings(mockSettings);
      expect(document.documentElement.dataset.reducedMotion).toBe('true');
    });

    test('removes reduced motion when disabled', () => {
      applyDesktopSettings({ ...mockSettings, reducedMotion: false });
      expect(document.documentElement.dataset.reducedMotion).toBeUndefined();
    });

    test('applies language to html lang', () => {
      applyDesktopSettings(mockSettings);
      expect(document.documentElement.lang).toBe('en');
    });

    test('applies light theme correctly', () => {
      const lightSettings: DesktopSettings = { ...mockSettings, theme: 'light' };
      applyDesktopSettings(lightSettings);
      expect(document.documentElement.dataset.theme).toBe('light');
    });
  });

  describe('loadDesktopSettings', () => {
    test('returns default settings in browser preview mode', async () => {
      const settings = await loadDesktopSettings();
      expect(settings.theme).toBe('light');
      expect(settings.language).toBe('en');
      expect(settings.fontSize).toBe(100);
      expect(settings.reducedMotion).toBe(false);
      expect(settings.autoSave).toBe(true);
      expect(settings.confirmDestructive).toBe(true);
      expect(settings.startupBehavior).toBe('restore');
      expect(settings).not.toHaveProperty('checkUpdates');
    });
  });

  describe('saveDesktopSettings', () => {
    test('persists to localStorage in browser preview mode', async () => {
      await saveDesktopSettings(mockSettings);
      const raw = localStorage.getItem(STORAGE_KEYS.desktopSettings);
      expect(raw).not.toBeNull();
      const parsed = JSON.parse(raw!);
      expect(parsed.theme).toBe('dark');
      expect(parsed.fontSize).toBe(115);
      expect(localStorage.getItem('hermes-desktop-settings')).toBeNull();
    });
  });

  describe('loadDesktopSettings', () => {
    test('returns default settings when browser preview storage is empty', async () => {
      const settings = await loadDesktopSettings();
      expect(settings.theme).toBe('light');
      expect(settings.language).toBe('en');
      expect(settings.fontSize).toBe(100);
      expect(settings.reducedMotion).toBe(false);
      expect(settings.autoSave).toBe(true);
      expect(settings.confirmDestructive).toBe(true);
      expect(settings.startupBehavior).toBe('restore');
      expect(settings).not.toHaveProperty('checkUpdates');
    });

    test('reads from localStorage in browser preview mode', async () => {
      await saveDesktopSettings(mockSettings);
      const settings = await loadDesktopSettings();
      expect(settings.theme).toBe('dark');
      expect(settings.fontSize).toBe(115);
      expect(settings.reducedMotion).toBe(true);
    });

    test('never reads or deletes the legacy Desktop key', async () => {
      localStorage.setItem('hermes-desktop-settings', JSON.stringify({ theme: 'dark' }));

      const settings = await loadDesktopSettings();

      expect(settings.theme).toBe('light');
      expect(localStorage.getItem('hermes-desktop-settings')).not.toBeNull();
    });

    test('drops retired updater state from the current browser record before re-saving', async () => {
      localStorage.setItem(STORAGE_KEYS.desktopSettings, JSON.stringify({
        theme: 'dark',
        checkUpdates: true,
      }));

      const settings = await loadDesktopSettings();
      expect(settings.theme).toBe('dark');
      expect(settings).not.toHaveProperty('checkUpdates');

      await saveDesktopSettings(settings);
      expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.desktopSettings)!)).not.toHaveProperty('checkUpdates');
    });
  });

  describe('Electron native settings', () => {
    test('loads and saves through the contained Hermes Home bridge', async () => {
      const readText = vi.fn(async () => JSON.stringify({
        theme: 'dark', fontSize: 110, checkUpdates: true,
      }));
      const writeText = vi.fn(async (_path: string, _content: string) => undefined);
      restoreHost?.();
      restoreHost = installNativeHostMock({
        hermesHome: { readText, writeText },
      } as unknown as HermesStudioBridge);

      const loaded = await loadDesktopSettings();
      expect(loaded).toMatchObject({ theme: 'dark', fontSize: 110 });
      expect(loaded).not.toHaveProperty('checkUpdates');
      await saveDesktopSettings(loaded);

      expect(readText).toHaveBeenCalledWith('desktop/settings.json');
      expect(writeText).toHaveBeenCalledWith(
        'desktop/settings.json',
        JSON.stringify(loaded, null, 2),
      );
      expect(writeText.mock.calls[0]?.[1]).not.toContain('checkUpdates');
      expect(localStorage.getItem(STORAGE_KEYS.desktopSettings)).toBeNull();
    });

    test('uses defaults when the contained native settings file cannot be read', async () => {
      restoreHost?.();
      restoreHost = installNativeHostMock({
        hermesHome: { readText: vi.fn(async () => { throw new Error('missing'); }) },
      } as unknown as HermesStudioBridge);

      await expect(loadDesktopSettings()).resolves.toMatchObject({ theme: 'light', fontSize: 100 });
    });
  });
});
