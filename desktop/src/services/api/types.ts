export type { McpServer, McpServerDesktop, McpServerDesktopPatch, McpTool } from '@/types/mcp.js';

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
  name?: string | null;
  skills?: string[];
  skill?: string | null;
  model?: string | null;
  provider?: string | null;
  base_url?: string | null;
  script?: string | null;
  schedule_display?: string | null;
  repeat?: { times?: number | null; completed?: number } | null;
  state?: string | null;
  paused_at?: string | null;
  paused_reason?: string | null;
  next_run_at?: string | null;
  last_run_at?: string | null;
  last_status?: string | null;
  last_error?: string | null;
  last_delivery_error?: string | null;
  deliver?: string | null;
  origin?: Record<string, unknown> | null;
  desktop: CronOverlay;
}

export interface CreateCronJobRequest {
  prompt: string;
  schedule: string;
  name?: string;
  repeat?: number | null;
  deliver?: string | null;
  origin?: Record<string, unknown> | null;
  skill?: string | null;
  skills?: string[] | null;
  model?: string | null;
  provider?: string | null;
  base_url?: string | null;
  script?: string | null;
}

export interface UpdateCronJobRequest extends Partial<CreateCronJobRequest> {
  enabled?: boolean;
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
  is_current?: boolean;
  has_overlay?: boolean;
  models: Array<Record<string, unknown>>;
  desktop: ProviderOverlay;
}

export interface Settings {
  schema_version: number;
  ui: Record<string, unknown>;
  desktop_sandbox: {
    mode: 'read-only' | 'workspace-write';
    network_access: 'restricted' | 'enabled';
  };
}

export interface ProfileInfo {
  id: string;
  name: string;
  hermesHome: string;
  path: string;
  isDefault: boolean;
  archived: boolean;
  createdAt: number;
  updatedAt: number;
  lastUsedAt: number | null;
  model: string | null;
  provider: string | null;
  hasEnv: boolean;
  skillCount: number;
  sessionCount: number;
  soul: string;
  setupCommand: string;
}

export interface ProfilesResponse {
  profiles: ProfileInfo[];
  activeProfileId: string;
  activeProfile: ProfileInfo;
}

export interface ActiveProfileResponse {
  activeProfileId: string;
  profile: ProfileInfo;
}

export interface ProfileCreateRequest {
  name: string;
  cloneFrom?: string | null;
  soul?: string | null;
}

export interface ProfileUpdateRequest {
  name?: string | null;
  soul?: string | null;
  isDefault?: boolean | null;
}

export interface ProfileSessionsResponse<TSession> {
  sessions: TSession[];
  total: number;
  profileTotals: Record<string, number>;
}

export type HermesConfigRecord = Record<string, unknown>;

export interface ConfigFieldSchema {
  type: string;
  description: string;
  category?: string;
  options?: string[];
  [key: string]: unknown;
}

export interface ConfigSchemaResponse {
  fields: Record<string, ConfigFieldSchema>;
  category_order: string[];
}

export interface ConfigReadResponse {
  config: HermesConfigRecord;
  mtime: number;
}

export interface ConfigSaveRequest {
  config: HermesConfigRecord;
  base_mtime?: number;
  changed_paths?: string[];
}

export interface ConfigSaveResponse {
  ok: boolean;
  mtime: number;
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
  /**
   * Extra fields from the error envelope that aren't part of the standard
   * shape. Used by the memory router's 409 conflict body to carry the
   * current server-side `MemoryFileWithContent` so the UI can offer a
   * merge dialog without a follow-up GET.
   */
  extra?: Record<string, unknown>;
}

export function isApiError(e: unknown): e is ApiError {
  return (
    e instanceof Error &&
    typeof (e as { code?: unknown }).code === 'string' &&
    typeof (e as { traceId?: unknown }).traceId === 'string'
  );
}

export type Domain = 'analytics' | 'config' | 'cron' | 'mcp' | 'model' | 'overlays' | 'plugins' | 'profiles' | 'settings' | 'skills' | 'state' | 'tools';

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

// ── OAuth provider types ──────────────────────────────────────────────────

export interface OAuthProvider {
  id: string;
  name: string;
  flow: 'pkce' | 'device_code' | 'loopback' | 'external';
  logged_in: boolean;
  source: string | null;
  source_label?: string | null;
  token_preview?: string | null;
  expires_at?: string | null;
  has_refresh_token: boolean;
  cli_command?: string | null;
  docs_url?: string | null;
}

export interface OAuthStartResponse {
  session_id: string;
  flow: 'pkce' | 'device_code' | 'loopback';
  auth_url?: string | null;
  expires_in?: number | null;
  user_code?: string | null;
  verification_url?: string | null;
  poll_interval?: number | null;
}

export interface OAuthPollResponse {
  session_id: string;
  status: 'pending' | 'approved' | 'denied' | 'expired' | 'error';
  error_message?: string | null;
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

export interface ToolInfo {
  name: string;
  description?: string | null;
  schema?: Record<string, unknown> | null;
  toolset?: string | null;
}
