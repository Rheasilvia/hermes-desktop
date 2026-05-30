import type { HttpClient } from '../../http-client';

export interface SessionTransport {
  setProvider(sessionId: string, provider: string, model: string): Promise<void>;
}

export function makeSessionTransport(c: HttpClient): SessionTransport {
  return {
    setProvider: (sessionId, provider, model) =>
      c.put<void>(`/desktop/api/sessions/${encodeURIComponent(sessionId)}/provider`, { provider, model }),
  };
}
