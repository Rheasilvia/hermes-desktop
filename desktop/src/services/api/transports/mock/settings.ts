import type { SettingsTransport } from '../http/settings';
import type { Settings } from '../../types';

export function makeMockSettingsTransport(): SettingsTransport {
  let s: Settings = { schema_version: 1, ui: { theme: 'system' } };
  return {
    get: async () => ({ ...s }),
    put: async (next) => {
      s = { ...next };
      return { ...s };
    },
  };
}
