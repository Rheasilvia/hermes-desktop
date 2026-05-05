import type { HttpClient } from '../../http-client';

export interface OverlayTransport {
  patch(
    domain: 'cron' | 'model',
    entityId: string,
    body: Record<string, unknown>,
  ): Promise<Record<string, unknown>>;
}

export function makeOverlayTransport(c: HttpClient): OverlayTransport {
  return {
    patch: (domain, id, body) =>
      c.patch(`/desktop/api/overlays/${domain}/${id}`, body),
  };
}
