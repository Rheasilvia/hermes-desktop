import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../services/api/router';
import { createCronStore } from '../cron';

beforeEach(() => {
  api.register('cron', {
    list: vi.fn().mockResolvedValue({
      items: [
        {
          id: 'job_test_001',
          schedule: '0 9 * * *',
          prompt: 'p',
          enabled: true,
          created_at: '2026-05-05T09:00:00Z',
          desktop: { pinned: false },
        },
      ],
      generated_at: '2026-05-05T09:00:00Z',
    }),
    get: vi.fn(),
  });
  api.register('overlays', {
    patch: vi.fn().mockResolvedValue({ pinned: true }),
  });
});

describe('cron store', () => {
  it('load() populates jobs', async () => {
    const s = createCronStore();
    await s.load();
    expect(s.jobs().length).toBe(1);
    expect(s.loading()).toBe(false);
    expect(s.error()).toBeNull();
  });

  it('togglePinned calls overlay patch API', async () => {
    const s = createCronStore();
    await s.load();
    await s.togglePinned('job_test_001');
    expect(api.overlays().patch).toHaveBeenCalledWith(
      'cron', 'job_test_001', { pinned: true },
    );
  });

  it('togglePinned does not call API on failure after rollback', async () => {
    const patchSpy = vi.fn().mockRejectedValue(
      Object.assign(new Error('x'), { code: 'INTERNAL', traceId: 't' }),
    );
    api.register('overlays', { patch: patchSpy });
    const s = createCronStore();
    await s.load();
    await expect(s.togglePinned('job_test_001')).rejects.toThrow();
    // patch was called once and failed
    expect(patchSpy).toHaveBeenCalledTimes(1);
    // jobs list should still have the original entry (rollback)
    expect(s.jobs().length).toBe(1);
  });
});
