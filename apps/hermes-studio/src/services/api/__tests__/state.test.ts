import { describe, expect, it, vi } from 'vitest';
import type { HttpClient } from '../http-client.js';
import { loadState, saveState } from '../state.js';

describe('desktop state transport', () => {
  it('loads through the shared authenticated HttpClient', async () => {
    const state = {
      schema_version: 1,
      last_open_route: '/conversation/session-1',
      last_session_id: 'session-1',
      last_cwd: '/workspace',
      window: { w: 1200, h: 800 },
    };
    const get = vi.fn(async () => state);

    await expect(loadState({ get } as unknown as HttpClient)).resolves.toEqual(state);
    expect(get).toHaveBeenCalledWith('/desktop/api/state');
  });

  it('saves through the shared authenticated HttpClient without accepting renderer tokens', async () => {
    const saved = {
      schema_version: 1,
      last_open_route: '/settings',
      last_session_id: null,
      last_cwd: null,
      window: { w: 900, h: 700 },
    };
    const put = vi.fn(async () => saved);

    await expect(saveState({ last_open_route: '/settings' }, { put } as unknown as HttpClient))
      .resolves.toEqual(saved);
    expect(put).toHaveBeenCalledWith('/desktop/api/state', { last_open_route: '/settings' });
  });
});
