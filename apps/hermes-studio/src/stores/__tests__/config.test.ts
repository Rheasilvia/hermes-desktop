import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../services/api/router';
import { configStore } from '../config';

const gatewaySet = vi.hoisted(() => vi.fn());

vi.mock('../context', () => ({
  getGateway: () => ({
    config: {
      get: vi.fn(),
      getMtime: vi.fn(),
      set: gatewaySet,
    },
  }),
}));

beforeEach(() => {
  gatewaySet.mockReset();
  api.register('config', {
    get: vi.fn().mockResolvedValue({
      config: { voice: { max_recording_seconds: 120 }, tts: { provider: 'edge' } },
      mtime: 123,
    }),
    defaults: vi.fn(),
    schema: vi.fn().mockResolvedValue({ fields: {}, category_order: [] }),
    put: vi.fn(),
  });
  api.register('settings', {
    get: vi.fn().mockResolvedValue({
      schema_version: 1,
      ui: {},
      desktop_sandbox: { mode: 'workspace-write', network_access: 'restricted' },
    }),
    put: vi.fn().mockImplementation(async (s) => s),
  });
});

describe('configStore', () => {
  it('loadConfig reads runtime config from config API', async () => {
    await configStore.loadConfig();

    expect(api.config().get).toHaveBeenCalled();
    expect(api.config().schema).toHaveBeenCalled();
    expect(api.settings().get).not.toHaveBeenCalled();
    expect(configStore.config?.voice?.max_recording_seconds).toBe(120);
  });

  it('saveConfig writes through gateway config set, not desktop settings', async () => {
    await configStore.saveConfig('voice.max_recording_seconds', 45);

    expect(gatewaySet).toHaveBeenCalledWith({
      key: 'voice.max_recording_seconds',
      value: 45,
      source: 'desktop',
    });
    expect(api.settings().put).not.toHaveBeenCalled();
  });
});
