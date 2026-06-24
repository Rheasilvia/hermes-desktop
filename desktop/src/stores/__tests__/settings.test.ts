import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../services/api/router';
import { createDesktopSettingsStore } from '../desktop-settings';

beforeEach(() => {
  api.register('settings', {
    get: vi
      .fn()
      .mockResolvedValue({
        schema_version: 1,
        ui: { theme: 'dark' },
        desktop_sandbox: { mode: 'workspace-write', network_access: 'restricted' },
      }),
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
    await s.save({
      schema_version: 1,
      ui: { theme: 'light' },
      desktop_sandbox: { mode: 'read-only', network_access: 'enabled' },
    });
    expect(s.settings().ui.theme).toBe('light');
    expect(s.settings().desktop_sandbox.mode).toBe('read-only');
  });

  it('saveDesktopSandbox() merges with latest backend settings', async () => {
    const s = createDesktopSettingsStore();
    const settingsApi = api.settings();
    const put = vi.mocked(settingsApi.put);

    await s.saveDesktopSandbox({ mode: 'read-only', network_access: 'enabled' });

    expect(put).toHaveBeenCalledWith({
      schema_version: 1,
      ui: { theme: 'dark' },
      desktop_sandbox: { mode: 'read-only', network_access: 'enabled' },
    });
    expect(s.settings().ui.theme).toBe('dark');
    expect(s.settings().desktop_sandbox.mode).toBe('read-only');
  });
});
