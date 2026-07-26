import type { HttpClient } from '../../http-client';
import type { Settings } from '../../types';

export interface SettingsTransport {
  get(): Promise<Settings>;
  put(s: Settings): Promise<Settings>;
}

export function makeSettingsTransport(c: HttpClient): SettingsTransport {
  return {
    get: () => c.get<Settings>('/desktop/api/settings'),
    put: (s) => c.put<Settings>('/desktop/api/settings', s),
  };
}
