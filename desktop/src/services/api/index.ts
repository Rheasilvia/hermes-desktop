import { api } from './router';
import { httpClient } from './http-client';
import { makeAnalyticsTransport } from './transports/http/analytics';
import { makeMockAnalyticsTransport } from './transports/mock/analytics';
import { makeCronTransport } from './transports/http/cron';
import { makeModelTransport } from './transports/http/model';
import { makeOverlayTransport } from './transports/http/overlays';
import { makeSettingsTransport } from './transports/http/settings';
import { makeSkillsTransport } from './transports/http/skills';
import { makeStateTransport } from './transports/http/state';

import { makeMockCronTransport } from './transports/mock/cron';
import { makeMockModelTransport } from './transports/mock/model';
import { makeMockOverlayTransport } from './transports/mock/overlays';
import { makeMockSettingsTransport } from './transports/mock/settings';
import { makeMockSkillsTransport } from './transports/mock/skills';
import { makeMockStateTransport } from './transports/mock/state';

export type {
  CronJob,
  Provider,
  Settings,
  SkillInfo,
  SkillsToolset,
  State,
  ListResponse,
  ApiError,
} from './types';
export { api } from './router';
export { isApiError } from './types';

export function bootstrapApi(mode: 'http' | 'mock' = 'http'): void {
  if (mode === 'mock') {
    api.register('cron', makeMockCronTransport());
    api.register('model', makeMockModelTransport());
    api.register('overlays', makeMockOverlayTransport());
    api.register('settings', makeMockSettingsTransport());
    api.register('skills', makeMockSkillsTransport());
    api.register('state', makeMockStateTransport());
    api.register('analytics', makeMockAnalyticsTransport());
    return;
  }
  api.register('cron', makeCronTransport(httpClient));
  api.register('model', makeModelTransport(httpClient));
  api.register('overlays', makeOverlayTransport(httpClient));
  api.register('settings', makeSettingsTransport(httpClient));
  api.register('skills', makeSkillsTransport(httpClient));
  api.register('state', makeStateTransport(httpClient));
  api.register('analytics', makeAnalyticsTransport(httpClient));
}
