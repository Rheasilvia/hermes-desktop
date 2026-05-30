import { api } from './router';
import { httpClient } from './http-client';
import { makeAnalyticsTransport } from './transports/http/analytics';
import { makeCronTransport } from './transports/http/cron';
import { makeModelTransport } from './transports/http/model';
import { makeOverlayTransport } from './transports/http/overlays';
import { makePluginsTransport } from './transports/http/plugins';
import { makeSessionTransport } from './transports/http/session';
import { makeSettingsTransport } from './transports/http/settings';
import { makeSkillsTransport } from './transports/http/skills';
import { makeStateTransport } from './transports/http/state';

export type {
  CronJob,
  Provider,
  Settings,
  SkillInfo,
  SkillsToolset,
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

export function bootstrapApi(): void {
  api.register('cron', makeCronTransport(httpClient));
  api.register('model', makeModelTransport(httpClient));
  api.register('overlays', makeOverlayTransport(httpClient));
  api.register('plugins', makePluginsTransport(httpClient));
  api.register('session', makeSessionTransport(httpClient));
  api.register('settings', makeSettingsTransport(httpClient));
  api.register('skills', makeSkillsTransport(httpClient));
  api.register('state', makeStateTransport(httpClient));
  api.register('analytics', makeAnalyticsTransport(httpClient));
}
