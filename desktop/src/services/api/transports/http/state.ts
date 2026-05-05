import type { HttpClient } from '../../http-client';
import type { State } from '../../types';

export interface StateTransport {
  get(): Promise<State>;
  put(s: State): Promise<State>;
}

export function makeStateTransport(c: HttpClient): StateTransport {
  return {
    get: () => c.get<State>('/desktop/api/state'),
    put: (s) => c.put<State>('/desktop/api/state', s),
  };
}
