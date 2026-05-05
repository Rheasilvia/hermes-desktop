export interface CronOverlay {
  pinned: boolean;
  color?: string | null;
  note?: string | null;
  updated_at?: string | null;
}

export interface CronJob {
  id: string;
  schedule: string;
  prompt: string;
  enabled: boolean;
  created_at: string;
  desktop: CronOverlay;
}

export interface ProviderOverlay {
  visible: boolean;
  display_order?: number | null;
  note?: string | null;
  updated_at?: string | null;
}

export interface Provider {
  id: string;
  name: string;
  auth?: string | null;
  models: Array<Record<string, unknown>>;
  desktop: ProviderOverlay;
}

export interface Settings {
  schema_version: number;
  ui: Record<string, unknown>;
}

export interface State {
  schema_version: number;
  last_open_route: string;
  window: Record<string, unknown>;
}

export interface ListResponse<T> {
  items: T[];
  generated_at: string | null;
}

export type ErrorCode =
  | 'AUTH_FAILED'
  | 'NOT_FOUND'
  | 'SCHEMA_VERSION'
  | 'VALIDATION'
  | 'LOCKED'
  | 'INTERNAL'
  | 'L1_CORRUPT'
  | 'L1_MISSING_DIR'
  | 'SIDECAR_DOWN';

export interface ApiError extends Error {
  code: ErrorCode | string;
  domain?: string;
  path?: string;
  traceId: string;
}

export function isApiError(e: unknown): e is ApiError {
  return (
    e instanceof Error &&
    typeof (e as { code?: unknown }).code === 'string' &&
    typeof (e as { traceId?: unknown }).traceId === 'string'
  );
}

export type Domain = 'cron' | 'model' | 'overlays' | 'settings' | 'state';
