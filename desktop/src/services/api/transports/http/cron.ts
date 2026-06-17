import type { HttpClient } from '../../http-client';
import type { CreateCronJobRequest, CronJob, ListResponse, UpdateCronJobRequest } from '../../types';

export interface CronTransport {
  list(): Promise<ListResponse<CronJob>>;
  get(id: string): Promise<CronJob>;
  create(job: CreateCronJobRequest): Promise<CronJob>;
  update(id: string, job: UpdateCronJobRequest): Promise<CronJob>;
  delete(id: string): Promise<{ ok: boolean }>;
}

export function makeCronTransport(c: HttpClient): CronTransport {
  return {
    list: () => c.get<ListResponse<CronJob>>('/desktop/api/cron/jobs'),
    get: (id) => c.get<CronJob>(`/desktop/api/cron/jobs/${id}`),
    create: (job) => c.post<CronJob>('/desktop/api/cron/jobs', job),
    update: (id, job) => c.patch<CronJob>(`/desktop/api/cron/jobs/${id}`, job),
    delete: (id) => c.delete<{ ok: boolean }>(`/desktop/api/cron/jobs/${id}`),
  };
}
