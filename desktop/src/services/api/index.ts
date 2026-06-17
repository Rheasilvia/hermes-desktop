import { api } from './router';
import { httpClient } from './http-client';
import { makeAnalyticsTransport } from './transports/http/analytics';
import { makeAudioTransport } from './transports/http/audio';
import { makeConfigTransport } from './transports/http/config';
import { makeCronTransport } from './transports/http/cron';
import { makeMcpTransport } from './transports/http/mcp';
import { makeModelTransport } from './transports/http/model';
import { makeOAuthTransport } from './transports/http/oauth';
import { makeOverlayTransport } from './transports/http/overlays';
import { makePluginsTransport } from './transports/http/plugins';
import { makeSessionTransport } from './transports/http/session';
import { makeSettingsTransport } from './transports/http/settings';
import { makeSkillsTransport } from './transports/http/skills';
import { makeStateTransport } from './transports/http/state';
import { makeToolsTransport } from './transports/http/tools';

export type {
  CronJob,
  CreateCronJobRequest,
  UpdateCronJobRequest,
  McpServer,
  McpServerDesktop,
  McpServerDesktopPatch,
  McpTool,
  Provider,
  OAuthProvider,
  OAuthStartResponse,
  OAuthPollResponse,
  Settings,
  ConfigFieldSchema,
  ConfigReadResponse,
  ConfigSaveRequest,
  ConfigSaveResponse,
  ConfigSchemaResponse,
  HermesConfigRecord,
  SkillInfo,
  SkillsToolset,
  ToolInfo,
  State,
  ListResponse,
  ApiError,
  PluginRow,
  PluginProviderOption,
  PluginProviders,
  PluginHubResponse,
  PluginInstallRequest,
  PluginInstallResponse,
  PluginProvidersRequest,
  PluginVisibilityRequest,
} from './types';
export { api } from './router';
export { isApiError } from './types';
export type {
  AuxMainEntry,
  AuxTaskEntry,
  AuxiliaryModelsResponse,
  ModelAssignmentRequest,
  ModelAssignmentResponse,
  ModelTransport,
  StaleAuxEntry,
} from './transports/http/model';

export function bootstrapApi(): void {
  api.register('cron', makeCronTransport(httpClient));
  api.register('mcp', makeMcpTransport(httpClient));
  api.register('model', makeModelTransport(httpClient));
  api.register('oauth', makeOAuthTransport(httpClient));
  api.register('overlays', makeOverlayTransport(httpClient));
  api.register('plugins', makePluginsTransport(httpClient));
  api.register('session', makeSessionTransport(httpClient));
  api.register('settings', makeSettingsTransport(httpClient));
  api.register('config', makeConfigTransport(httpClient));
  api.register('skills', makeSkillsTransport(httpClient));
  api.register('state', makeStateTransport(httpClient));
  api.register('tools', makeToolsTransport(httpClient));
  api.register('analytics', makeAnalyticsTransport(httpClient));
  api.register('audio', makeAudioTransport(httpClient));
}
