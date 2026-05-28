import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  loadDesktopSettings,
  saveDesktopSettings,
  applyDesktopSettings,
  type DesktopSettings,
} from '../desktop-settings.js';

describe('desktop-settings', () => {
  const mockSettings: DesktopSettings = {
    theme: 'dark',
    language: 'en',
    fontSize: 115,
    reducedMotion: true,
    autoSave: false,
    confirmDestructive: true,
    startupBehavior: 'new',
    checkUpdates: false,
    showCost: false,
    showReasoning: false,
  };

  beforeEach(() => {
    // Reset DOM state before each test
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.removeAttribute('data-reduced-motion');
    document.documentElement.removeAttribute('lang');
    document.documentElement.style.fontSize = '';
    // Clear localStorage to avoid cross-test leakage
    localStorage.clear();
  });

  afterEach(() => {
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

    test('applies earth theme correctly', () => {
      const earthSettings: DesktopSettings = { ...mockSettings, theme: 'earth' };
      applyDesktopSettings(earthSettings);
      expect(document.documentElement.dataset.theme).toBe('earth');
    });

    test('applies light theme correctly', () => {
      const lightSettings: DesktopSettings = { ...mockSettings, theme: 'light' };
      applyDesktopSettings(lightSettings);
      expect(document.documentElement.dataset.theme).toBe('light');
    });
  });

  describe('loadDesktopSettings', () => {
    test('returns default settings when Tauri is unavailable', async () => {
      const settings = await loadDesktopSettings();
      expect(settings.theme).toBe('earth');
      expect(settings.language).toBe('en');
      expect(settings.fontSize).toBe(100);
      expect(settings.reducedMotion).toBe(false);
      expect(settings.autoSave).toBe(true);
      expect(settings.confirmDestructive).toBe(true);
      expect(settings.startupBehavior).toBe('restore');
      expect(settings.checkUpdates).toBe(true);
    });
  });

  describe('saveDesktopSettings', () => {
    test('persists to localStorage when Tauri is unavailable', async () => {
      await saveDesktopSettings(mockSettings);
      const raw = localStorage.getItem('hermes-desktop-settings');
      expect(raw).not.toBeNull();
      const parsed = JSON.parse(raw!);
      expect(parsed.theme).toBe('dark');
      expect(parsed.fontSize).toBe(115);
    });
  });

  describe('loadDesktopSettings', () => {
    test('returns default settings when Tauri is unavailable and localStorage is empty', async () => {
      const settings = await loadDesktopSettings();
      expect(settings.theme).toBe('earth');
      expect(settings.language).toBe('en');
      expect(settings.fontSize).toBe(100);
      expect(settings.reducedMotion).toBe(false);
      expect(settings.autoSave).toBe(true);
      expect(settings.confirmDestructive).toBe(true);
      expect(settings.startupBehavior).toBe('restore');
      expect(settings.checkUpdates).toBe(true);
    });

    test('reads from localStorage when Tauri is unavailable', async () => {
      await saveDesktopSettings(mockSettings);
      const settings = await loadDesktopSettings();
      expect(settings.theme).toBe('dark');
      expect(settings.fontSize).toBe(115);
      expect(settings.reducedMotion).toBe(true);
    });
  });
});
