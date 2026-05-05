import { createSignal } from 'solid-js';
import { api } from '../services/api/router';
import type { CronJob as ApiCronJob } from '../services/api/types';
import type { CronJob } from '../types/cron.js';

function mapJob(api: ApiCronJob): CronJob {
  return {
    id: api.id,
    name: api.prompt.slice(0, 40),
    prompt: api.prompt,
    skills: [],
    skill: null,
    model: null,
    provider: null,
    base_url: null,
    script: null,
    schedule: { kind: 'cron', expr: api.schedule, display: api.schedule },
    schedule_display: api.schedule,
    repeat: { times: null, completed: 0 },
    enabled: api.enabled,
    state: api.enabled ? 'scheduled' : 'paused',
    paused_at: api.enabled ? null : new Date().toISOString(),
    paused_reason: null,
    created_at: api.created_at,
    next_run_at: null,
    last_run_at: null,
    last_status: null,
    last_error: null,
    last_delivery_error: null,
    deliver: 'local',
    origin: null,
  };
}

export interface CronStore {
  jobs: () => CronJob[];
  loading: () => boolean;
  error: () => Error | null;
  load: () => Promise<void>;
  togglePinned: (id: string) => Promise<void>;
}

export function createCronStore(): CronStore {
  const [apiJobs, setApiJobs] = createSignal<ApiCronJob[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<Error | null>(null);

  const jobs = () => apiJobs().map(mapJob);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await api.cron().list();
      setApiJobs(resp.items);
    } catch (e) {
      setError(e as Error);
    } finally {
      setLoading(false);
    }
  };

  const togglePinned = async (id: string) => {
    const prev = apiJobs();
    const idx = prev.findIndex((j) => j.id === id);
    if (idx < 0) return;
    const target = prev[idx];
    const optimistic: ApiCronJob = {
      ...target,
      desktop: { ...target.desktop, pinned: !target.desktop.pinned },
    };
    setApiJobs(prev.map((j, i) => (i === idx ? optimistic : j)));
    try {
      await api
        .overlays()
        .patch('cron', id, { pinned: optimistic.desktop.pinned });
    } catch (e) {
      setApiJobs(prev);
      throw e;
    }
  };

  return { jobs, loading, error, load, togglePinned };
}

export const cronStore = createCronStore();
