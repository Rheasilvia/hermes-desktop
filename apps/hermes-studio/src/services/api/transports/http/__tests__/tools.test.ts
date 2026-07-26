import { describe, expect, it, vi } from 'vitest';
import { makeToolsTransport } from '../tools';

describe('tools http transport', () => {
  it('list calls GET /tools', async () => {
    const client = { get: vi.fn().mockResolvedValue({ items: [] }) };
    const t = makeToolsTransport(client as never);
    await t.list();
    expect(client.get).toHaveBeenCalledWith('/desktop/api/tools');
  });

  it('reload calls POST /tools/reload', async () => {
    const client = { post: vi.fn().mockResolvedValue({ items: [] }) };
    const t = makeToolsTransport(client as never);
    await t.reload();
    expect(client.post).toHaveBeenCalledWith('/desktop/api/tools/reload', {});
  });
});
