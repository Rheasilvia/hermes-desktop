import { describe, expect, it, vi } from 'vitest';
import { makeCronTransport } from '../cron';

describe('cron http transport', () => {
  it('list calls GET /cron/jobs', async () => {
    const client = {
      get: vi.fn().mockResolvedValue({ items: [], generated_at: null }),
    };
    const t = makeCronTransport(client as never);
    await t.list();
    expect(client.get).toHaveBeenCalledWith('/desktop/api/cron/jobs');
  });

  it('get calls GET /cron/jobs/:id', async () => {
    const client = { get: vi.fn().mockResolvedValue({ id: 'job_test_001' }) };
    const t = makeCronTransport(client as never);
    const out = await t.get('job_test_001');
    expect(client.get).toHaveBeenCalledWith(
      '/desktop/api/cron/jobs/job_test_001',
    );
    expect(out.id).toBe('job_test_001');
  });
});
