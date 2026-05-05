import { createSignal } from 'solid-js';
import { api } from '../services/api/router';
import type { CronJob } from '../services/api/types';

export interface CronStore {
  jobs: () => CronJob[];
  loading: () => boolean;
  error: () => Error | null;
  load: () => Promise<void>;
  togglePinned: (id: string) => Promise<void>;
}

export function createCronStore(): CronStore {
  const [jobs, setJobs] = createSignal<CronJob[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<Error | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await api.cron().list();
      setJobs(resp.items);
    } catch (e) {
      setError(e as Error);
    } finally {
      setLoading(false);
    }
  };

  const togglePinned = async (id: string) => {
    const prev = jobs();
    const idx = prev.findIndex((j) => j.id === id);
    if (idx < 0) return;
    const target = prev[idx];
    const optimistic: CronJob = {
      ...target,
      desktop: { ...target.desktop, pinned: !target.desktop.pinned },
    };
    setJobs(prev.map((j, i) => (i === idx ? optimistic : j)));
    try {
      await api
        .overlays()
        .patch('cron', id, { pinned: optimistic.desktop.pinned });
    } catch (e) {
      setJobs(prev);
      throw e;
    }
  };

  return { jobs, loading, error, load, togglePinned };
}

export const cronStore = createCronStore();
