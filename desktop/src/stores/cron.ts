import { createSignal } from 'solid-js';
import { api } from '../services/api/router';
import type { CronJob as ApiCronJob } from '../services/api/types';
import type { CreateCronJobParams, CronJob, UpdateCronJobParams } from '../types/cron.js';

/* ── minimal 5‑field cron helpers ── */

const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function parseField(f: string, max: number): number[] {
  const vals = new Set<number>();
  for (const part of f.split(',')) {
    if (part === '*') {
      for (let i = 0; i < max; i++) vals.add(i);
      continue;
    }
    const stepMatch = part.match(/^(.+)\/(\d+)$/);
    const step = stepMatch ? parseInt(stepMatch[2], 10) : 1;
    const base = stepMatch ? stepMatch[1] : part;
    const rangeMatch = base.match(/^(\d+)-(\d+)$/);
    if (rangeMatch) {
      for (let i = parseInt(rangeMatch[1], 10); i <= parseInt(rangeMatch[2], 10); i += step) {
        vals.add(i);
      }
    } else {
      vals.add(parseInt(base, 10));
    }
  }
  return [...vals].sort((a, b) => a - b);
}

function nextMatch(
  expr: string,
  from: Date = new Date(),
): Date | null {
  const [minF, hourF, domF, monthF, dowF] = expr.trim().split(/\s+/);
  if (!minF || !hourF || !domF || !monthF || !dowF) return null;

  const mins = parseField(minF, 60);
  const hours = parseField(hourF, 24);
  const doms = parseField(domF, 32);
  const months = parseField(monthF, 13);
  const dows = parseField(dowF, 7);

  // search up to 2 years ahead
  const limit = new Date(from);
  limit.setFullYear(limit.getFullYear() + 2);

  const d = new Date(from);
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() + 1); // start from next minute

  while (d <= limit) {
    const m = d.getMonth() + 1;
    const day = d.getDate();
    const dow = d.getDay();
    if (
      months.includes(m) &&
      doms.includes(day) &&
      dows.includes(dow) &&
      hours.includes(d.getHours()) &&
      mins.includes(d.getMinutes())
    ) {
      return new Date(d);
    }
    d.setMinutes(d.getMinutes() + 1);
  }
  return null;
}

function cronDisplay(expr: string): string {
  const parts = expr.trim().split(/\s+/);
  if (parts.length < 5) return expr;
  const [min, hour, dom, month, dow] = parts;

  const minStr = `${min.padStart(2, '0')}`;
  const h = parseInt(hour, 10);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  const timeStr = `${h12}:${minStr} ${ampm}`;

  if (dom === '*' && month === '*' && dow === '*') {
    return `Every day at ${timeStr}`;
  }
  if (dom === '*' && month === '*' && dow !== '*') {
    const days = parseField(dow, 7);
    if (days.length === 5 && days[0] === 1 && days[4] === 5) {
      return `Weekdays at ${timeStr}`;
    }
    const names = days.map((d) => DAY_NAMES[d]).join(', ');
    return `${names} at ${timeStr}`;
  }
  if (dom !== '*' && month === '*') {
    return `Day ${dom} of each month at ${timeStr}`;
  }
  return expr;
}

function mapJob(api: ApiCronJob): CronJob {
  const now = new Date().toISOString();
  const next = nextMatch(api.schedule);
  return {
    id: api.id,
    name: api.name ?? api.prompt.slice(0, 40),
    prompt: api.prompt,
    skills: api.skills ?? [],
    skill: api.skill ?? null,
    model: api.model ?? null,
    provider: api.provider ?? null,
    base_url: api.base_url ?? null,
    script: api.script ?? null,
    schedule: { kind: 'cron', expr: api.schedule, display: api.schedule_display ?? cronDisplay(api.schedule) },
    schedule_display: api.schedule_display ?? cronDisplay(api.schedule),
    repeat: { times: api.repeat?.times ?? null, completed: api.repeat?.completed ?? 0 },
    enabled: api.enabled,
    state: (api.state as CronJob['state'] | null) ?? (api.enabled ? 'scheduled' : 'paused'),
    paused_at: api.paused_at ?? (api.enabled ? null : now),
    paused_reason: api.paused_reason ?? (api.enabled ? null : 'Paused by user'),
    created_at: api.created_at,
    next_run_at: api.next_run_at ?? (next ? next.toISOString() : null),
    last_run_at: api.last_run_at ?? null,
    last_status: api.last_status === 'ok' || api.last_status === 'error' ? api.last_status : null,
    last_error: api.last_error ?? null,
    last_delivery_error: api.last_delivery_error ?? null,
    deliver: api.deliver ?? 'local',
    origin: api.origin ?? null,
  };
}

export interface CronStore {
  jobs: () => CronJob[];
  loading: () => boolean;
  error: () => Error | null;
  load: () => Promise<void>;
  create: (params: CreateCronJobParams) => Promise<CronJob>;
  update: (id: string, params: UpdateCronJobParams) => Promise<CronJob>;
  delete: (id: string) => Promise<void>;
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

  const create = async (params: CreateCronJobParams) => {
    const created = await api.cron().create(params);
    setApiJobs((prev) => [...prev, created]);
    return mapJob(created);
  };

  const update = async (id: string, params: UpdateCronJobParams) => {
    const updated = await api.cron().update(id, params);
    setApiJobs((prev) => prev.map((j) => (j.id === id ? updated : j)));
    return mapJob(updated);
  };

  const deleteJob = async (id: string) => {
    await api.cron().delete(id);
    setApiJobs((prev) => prev.filter((j) => j.id !== id));
  };

  return { jobs, loading, error, load, create, update, delete: deleteJob, togglePinned };
}

export const cronStore = createCronStore();
