import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../services/api/router';
import { createDesktopSettingsStore } from '../desktop-settings';

beforeEach(() => {
  api.register('settings', {
    get: vi
      .fn()
      .mockResolvedValue({ schema_version: 1, ui: { theme: 'dark' } }),
    put: vi.fn().mockImplementation(async (s) => s),
  });
});

describe('settings store', () => {
  it('load() pulls from api', async () => {
    const s = createDesktopSettingsStore();
    await s.load();
    expect(s.settings().ui.theme).toBe('dark');
  });

  it('save() round-trips', async () => {
    const s = createDesktopSettingsStore();
    await s.load();
    await s.save({ schema_version: 1, ui: { theme: 'light' } });
    expect(s.settings().ui.theme).toBe('light');
  });
});
