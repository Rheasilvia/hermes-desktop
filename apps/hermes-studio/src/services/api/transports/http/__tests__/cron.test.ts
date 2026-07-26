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

  it('create calls POST /cron/jobs', async () => {
    const client = { post: vi.fn().mockResolvedValue({ id: 'created' }) };
    const t = makeCronTransport(client as never);
    await t.create({ prompt: 'hello', schedule: '0 9 * * *' });
    expect(client.post).toHaveBeenCalledWith('/desktop/api/cron/jobs', {
      prompt: 'hello',
      schedule: '0 9 * * *',
    });
  });

  it('update calls PATCH /cron/jobs/:id', async () => {
    const client = { patch: vi.fn().mockResolvedValue({ id: 'job_test_001' }) };
    const t = makeCronTransport(client as never);
    await t.update('job_test_001', { enabled: false });
    expect(client.patch).toHaveBeenCalledWith(
      '/desktop/api/cron/jobs/job_test_001',
      { enabled: false },
    );
  });

  it('delete calls DELETE /cron/jobs/:id', async () => {
    const client = { delete: vi.fn().mockResolvedValue({ ok: true }) };
    const t = makeCronTransport(client as never);
    await t.delete('job_test_001');
    expect(client.delete).toHaveBeenCalledWith('/desktop/api/cron/jobs/job_test_001');
  });
});
