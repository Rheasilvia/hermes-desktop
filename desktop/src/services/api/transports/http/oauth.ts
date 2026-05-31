import type { HttpClient } from '../../http-client';
import type { OAuthProvider, OAuthStartResponse, OAuthPollResponse } from '../../types';

export interface OAuthTransport {
  listProviders(): Promise<OAuthProvider[]>;
  start(providerId: string): Promise<OAuthStartResponse>;
  submit(providerId: string, sessionId: string, code: string): Promise<{ ok: boolean }>;
  poll(providerId: string, sessionId: string): Promise<OAuthPollResponse>;
  disconnect(providerId: string): Promise<void>;
  cancelSession(sessionId: string): Promise<void>;
}

export function makeOAuthTransport(c: HttpClient): OAuthTransport {
  const base = '/desktop/api/providers/oauth';
  return {
    listProviders: () =>
      c.get<OAuthProvider[]>(base),

    start: (providerId) =>
      c.post<OAuthStartResponse>(`${base}/${encodeURIComponent(providerId)}/start`, {}),

    submit: (providerId, sessionId, code) =>
      c.post<{ ok: boolean }>(
        `${base}/${encodeURIComponent(providerId)}/submit`,
        { session_id: sessionId, code },
      ),

    poll: (providerId, sessionId) =>
      c.get<OAuthPollResponse>(
        `${base}/${encodeURIComponent(providerId)}/poll/${encodeURIComponent(sessionId)}`,
      ),

    disconnect: (providerId) =>
      c.delete<void>(`${base}/${encodeURIComponent(providerId)}`),

    cancelSession: (sessionId) =>
      c.delete<void>(`${base}/sessions/${encodeURIComponent(sessionId)}`),
  };
}
