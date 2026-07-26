import { describe, expect, it, vi } from 'vitest';
import { makePluginsTransport } from '../plugins';

const BASE = '/desktop/api/plugins';

describe('plugins http transport', () => {
  it('getHub calls GET /plugins/hub', async () => {
    const client = { get: vi.fn().mockResolvedValue({ plugins: [], providers: {} }) };
    const t = makePluginsTransport(client as never);
    await t.getHub();
    expect(client.get).toHaveBeenCalledWith(`${BASE}/hub`);
  });

  it('rescan calls GET /plugins/rescan', async () => {
    const client = { get: vi.fn().mockResolvedValue({ ok: true, count: 0 }) };
    const t = makePluginsTransport(client as never);
    await t.rescan();
    expect(client.get).toHaveBeenCalledWith(`${BASE}/rescan`);
  });

  it('install calls POST /plugins/install with body', async () => {
    const client = { post: vi.fn().mockResolvedValue({ ok: true }) };
    const t = makePluginsTransport(client as never);
    await t.install({ identifier: 'owner/repo', force: false, enable: true });
    expect(client.post).toHaveBeenCalledWith(`${BASE}/install`, {
      identifier: 'owner/repo',
      force: false,
      enable: true,
    });
  });

  it('enable calls POST /plugins/:name/enable', async () => {
    const client = { post: vi.fn().mockResolvedValue({ ok: true }) };
    const t = makePluginsTransport(client as never);
    await t.enable('my-plugin');
    expect(client.post).toHaveBeenCalledWith(`${BASE}/my-plugin/enable`, {});
  });

  it('disable calls POST /plugins/:name/disable', async () => {
    const client = { post: vi.fn().mockResolvedValue({ ok: true }) };
    const t = makePluginsTransport(client as never);
    await t.disable('my-plugin');
    expect(client.post).toHaveBeenCalledWith(`${BASE}/my-plugin/disable`, {});
  });

  it('update calls POST /plugins/:name/update', async () => {
    const client = { post: vi.fn().mockResolvedValue({ ok: true }) };
    const t = makePluginsTransport(client as never);
    await t.update('my-plugin');
    expect(client.post).toHaveBeenCalledWith(`${BASE}/my-plugin/update`, {});
  });

  it('remove calls DELETE /plugins/:name', async () => {
    const client = { delete: vi.fn().mockResolvedValue({ ok: true }) };
    const t = makePluginsTransport(client as never);
    await t.remove('my-plugin');
    expect(client.delete).toHaveBeenCalledWith(`${BASE}/my-plugin`);
  });

  it('saveProviders calls PUT /plugins/providers', async () => {
    const client = { put: vi.fn().mockResolvedValue({ ok: true }) };
    const t = makePluginsTransport(client as never);
    await t.saveProviders({ memory_provider: 'mem-plugin', context_engine: null });
    expect(client.put).toHaveBeenCalledWith(`${BASE}/providers`, {
      memory_provider: 'mem-plugin',
      context_engine: null,
    });
  });

  it('setVisibility calls PUT /plugins/:name/visibility', async () => {
    const client = { put: vi.fn().mockResolvedValue({ ok: true }) };
    const t = makePluginsTransport(client as never);
    await t.setVisibility('my-plugin', true);
    expect(client.put).toHaveBeenCalledWith(`${BASE}/my-plugin/visibility`, { hidden: true });
  });

  it('encodes plugin names with special characters', async () => {
    const client = { post: vi.fn().mockResolvedValue({ ok: true }) };
    const t = makePluginsTransport(client as never);
    await t.enable('owner/repo');
    expect(client.post).toHaveBeenCalledWith(`${BASE}/owner%2Frepo/enable`, {});
  });
});
