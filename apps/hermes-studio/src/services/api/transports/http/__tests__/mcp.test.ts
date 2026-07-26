import { describe, expect, it, vi } from 'vitest';
import { makeMcpTransport } from '../mcp';

describe('mcp http transport', () => {
  it('list calls GET /mcp/servers', async () => {
    const client = { get: vi.fn().mockResolvedValue({ items: [] }) };
    const t = makeMcpTransport(client as never);
    await t.list();
    expect(client.get).toHaveBeenCalledWith('/desktop/api/mcp/servers');
  });

  it('add calls POST /mcp/servers', async () => {
    const client = { post: vi.fn().mockResolvedValue({ name: 'time' }) };
    const t = makeMcpTransport(client as never);
    await t.add({ name: 'time', transport: 'stdio', command: 'uvx' });
    expect(client.post).toHaveBeenCalledWith('/desktop/api/mcp/servers', {
      name: 'time',
      transport: 'stdio',
      command: 'uvx',
    });
  });

  it('reload calls POST /mcp/reload', async () => {
    const client = { post: vi.fn().mockResolvedValue({ ok: true, items: [] }) };
    const t = makeMcpTransport(client as never);
    await t.reload();
    expect(client.post).toHaveBeenCalledWith('/desktop/api/mcp/reload', {});
  });

  it('remove encodes server name', async () => {
    const client = { delete: vi.fn().mockResolvedValue({ ok: true }) };
    const t = makeMcpTransport(client as never);
    await t.remove('owner/server');
    expect(client.delete).toHaveBeenCalledWith('/desktop/api/mcp/servers/owner%2Fserver');
  });

  it('patchDesktop calls PATCH /mcp/servers/:id/desktop', async () => {
    const client = { patch: vi.fn().mockResolvedValue({ pinned: true }) };
    const t = makeMcpTransport(client as never);
    await t.patchDesktop('owner/server', { pinned: true });
    expect(client.patch).toHaveBeenCalledWith(
      '/desktop/api/mcp/servers/owner%2Fserver/desktop',
      { pinned: true },
    );
  });

  it('tools encodes server name', async () => {
    const client = { get: vi.fn().mockResolvedValue({ items: [] }) };
    const t = makeMcpTransport(client as never);
    await t.tools('owner/server');
    expect(client.get).toHaveBeenCalledWith('/desktop/api/mcp/servers/owner%2Fserver/tools');
  });
});
