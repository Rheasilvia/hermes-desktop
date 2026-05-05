import type { OverlayTransport } from '../http/overlays';

export function makeMockOverlayTransport(): OverlayTransport {
  return {
    patch: async (_domain, _id, body) => ({ ...body }),
  };
}
