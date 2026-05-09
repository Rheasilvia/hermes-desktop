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
  last_run_at?: string | null;
  last_status?: string | null;
  last_error?: string | null;
  desktop: CronOverlay;
}

export interface ProviderOverlay {
  visible: boolean;
  display_order?: number | null;
  note?: string | null;
  updated_at?: string | null;
  base_url?: string | null;
  api_key?: string | null;
  api_key_env?: string | null;
  api_key_set?: boolean;
  api_key_preview?: string | null;
  api_key_source?: string | null;
  base_url_source?: string | null;
  display_name?: string | null;
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

export type Domain = 'analytics' | 'cron' | 'model' | 'overlays' | 'plugins' | 'settings' | 'skills' | 'state';

export interface PluginRow {
  name: string;
  version: string;
  description: string;
  source: string;
  runtime_status: string;
  has_dashboard_manifest: boolean;
  dashboard_manifest: Record<string, unknown> | null;
  path: string;
  can_remove: boolean;
  can_update_git: boolean;
  auth_required: boolean;
  auth_command: string;
  user_hidden: boolean;
}

export interface PluginProviderOption {
  name: string;
  description: string;
}

export interface PluginProviders {
  memory_provider: string;
  memory_options: PluginProviderOption[];
  context_engine: string | null;
  context_options: PluginProviderOption[];
}

export interface PluginHubResponse {
  plugins: PluginRow[];
  orphan_dashboard_plugins: Record<string, unknown>[];
  providers: PluginProviders;
}

export interface PluginInstallRequest {
  identifier: string;
  force?: boolean;
  enable?: boolean;
}

export interface PluginInstallResponse {
  ok: boolean;
  plugin_name?: string | null;
  warnings?: string[] | null;
  missing_env?: string[] | null;
}

export interface PluginProvidersRequest {
  memory_provider?: string | null;
  context_engine?: string | null;
}

export interface PluginVisibilityRequest {
  hidden: boolean;
}

export interface SkillInfo {
  name: string;
  description: string;
  category: string;
  enabled: boolean;
}

export interface SkillsToolset {
  name: string;
  label: string;
  description: string;
  enabled: boolean;
  configured: boolean;
  tools: string[];
}
