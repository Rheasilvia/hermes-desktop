import type { CronTransport } from '../http/cron';
import type { CronJob, ListResponse } from '../../types';

const SEED: CronJob[] = [
  {
    id: 'job_test_001',
    schedule: '0 9 * * *',
    prompt: 'morning briefing',
    enabled: true,
    created_at: '2026-05-05T09:00:00Z',
    desktop: { pinned: false },
  },
  {
    id: 'job_test_002',
    schedule: '*/5 * * * *',
    prompt: 'poll',
    enabled: false,
    created_at: '2026-05-05T09:00:00Z',
    desktop: { pinned: false },
  },
];

export function makeMockCronTransport(): CronTransport {
  let store = SEED.map((j) => ({ ...j, desktop: { ...j.desktop } }));
  return {
    list: async (): Promise<ListResponse<CronJob>> => ({
      items: store.map((j) => ({ ...j, desktop: { ...j.desktop } })),
      generated_at: '2026-05-05T09:00:00Z',
    }),
    get: async (id) => {
      const found = store.find((j) => j.id === id);
      if (!found) {
        const e = new Error('not found') as Error & {
          code: string;
          traceId: string;
        };
        e.code = 'NOT_FOUND';
        e.traceId = 'mock';
        throw e;
      }
      return { ...found, desktop: { ...found.desktop } };
    },
  };
}
