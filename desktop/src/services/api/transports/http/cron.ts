import type { HttpClient } from '../../http-client';
import type { CronJob, ListResponse } from '../../types';

export interface CronTransport {
  list(): Promise<ListResponse<CronJob>>;
  get(id: string): Promise<CronJob>;
}

export function makeCronTransport(c: HttpClient): CronTransport {
  return {
    list: () => c.get<ListResponse<CronJob>>('/desktop/api/cron/jobs'),
    get: (id) => c.get<CronJob>(`/desktop/api/cron/jobs/${id}`),
  };
}
