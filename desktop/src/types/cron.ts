/**
 * Cron job types matching cron/jobs.py.
 * @source cron/jobs.py
 */

/** Schedule kind. */
export type ScheduleKind = 'once' | 'interval' | 'cron';

/** Schedule for a cron job. */
export interface Schedule {
  kind: ScheduleKind;
  expr?: string;
  minutes?: number;
  run_at?: string;
  display: string;
}

/** Repeat configuration for a cron job. */
export interface Repeat {
  times: number | null;
  completed: number;
}

/** Delivery kind. */
export type DeliveryKind = 'origin' | 'local' | string;

/** Delivery configuration for a cron job. */
export interface Delivery {
  kind: DeliveryKind;
  channels?: string[];
}

/** Cron job as stored in jobs.json. */
export interface CronJob {
  id: string;
  name: string;
  prompt: string;
  skills: string[];
  skill: string | null;
  model: string | null;
  provider: string | null;
  base_url: string | null;
  api_key?: string | null;
  script: string | null;
  schedule: Schedule;
  schedule_display: string;
  repeat: Repeat;
  enabled: boolean;
  state: 'scheduled' | 'paused' | 'completed' | 'running';
  paused_at: string | null;
  paused_reason: string | null;
  created_at: string;
  next_run_at: string | null;
  last_run_at: string | null;
  last_status: 'ok' | 'error' | null;
  last_error: string | null;
  last_delivery_error: string | null;
  deliver: DeliveryKind;
  origin: Record<string, unknown> | null;
}

/** Cron job creation parameters. */
export interface CreateCronJobParams {
  prompt: string;
  schedule: string;
  name?: string;
  repeat?: number | null;
  deliver?: DeliveryKind | null;
  origin?: Record<string, unknown> | null;
  skill?: string | null;
  skills?: string[] | null;
  model?: string | null;
  provider?: string | null;
  base_url?: string | null;
  script?: string | null;
}

/** Cron job update parameters. */
export interface UpdateCronJobParams {
  name?: string;
  prompt?: string;
  schedule?: string;
  enabled?: boolean;
  repeat?: number | null;
  deliver?: DeliveryKind | null;
  skill?: string | null;
  skills?: string[] | null;
  model?: string | null;
  provider?: string | null;
  base_url?: string | null;
  script?: string | null;
}
