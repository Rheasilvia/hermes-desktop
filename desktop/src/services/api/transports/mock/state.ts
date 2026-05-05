import type { StateTransport } from '../http/state';
import type { State } from '../../types';

export function makeMockStateTransport(): StateTransport {
  let s: State = { schema_version: 1, last_open_route: '/', window: {} };
  return {
    get: async () => ({ ...s }),
    put: async (next) => {
      s = { ...next };
      return { ...s };
    },
  };
}
