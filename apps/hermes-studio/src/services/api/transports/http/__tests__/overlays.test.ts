import { describe, expect, it, vi } from 'vitest';
import { makeOverlayTransport } from '../overlays';

describe('overlays http transport', () => {
  it('patch builds correct path + body', async () => {
    const client = { patch: vi.fn().mockResolvedValue({ pinned: true }) };
    const t = makeOverlayTransport(client as never);
    await t.patch('cron', 'job_test_001', { pinned: true });
    expect(client.patch).toHaveBeenCalledWith(
      '/desktop/api/overlays/cron/job_test_001',
      { pinned: true },
    );
  });
});
