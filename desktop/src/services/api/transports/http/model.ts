import type { HttpClient } from '../../http-client';
import type { ListResponse, Provider } from '../../types';

export interface ModelTransport {
  listProviders(opts?: { configuredOnly?: boolean }): Promise<ListResponse<Provider>>;
  getCatalog(): Promise<{ providers: Provider[]; fetched_at: string | null }>;
  getActiveModel(): Promise<{ provider: string | null; model: string | null }>;
  setActiveModel(provider: string, model: string): Promise<void>;
  revealProviderApiKey(provider: string): Promise<{ provider: string; api_key: string; source: string }>;
  deleteProvider(providerId: string): Promise<void>;
}

export function makeModelTransport(c: HttpClient): ModelTransport {
  return {
    listProviders: (opts) => {
      const params = new URLSearchParams();
      if (opts?.configuredOnly === false) {
        params.set('configured_only', 'false');
      }
      const qs = params.toString();
      const path = '/desktop/api/model/providers' + (qs ? `?${qs}` : '');
      return c.get<ListResponse<Provider>>(path);
    },
    getCatalog: () =>
      c.get<{ providers: Provider[]; fetched_at: string | null }>(
        '/desktop/api/model/catalog',
      ),
    getActiveModel: () =>
      c.get<{ provider: string | null; model: string | null }>(
        '/desktop/api/model/active',
      ),
    setActiveModel: (provider, model) =>
      c.put<void>('/desktop/api/model/active', { provider, model }),
    revealProviderApiKey: (provider) =>
      c.post<{ provider: string; api_key: string; source: string }>(
        `/desktop/api/model/providers/${encodeURIComponent(provider)}/api-key/reveal`,
        {},
      ),
    deleteProvider: (providerId) =>
      c.delete<void>(`/desktop/api/model/providers/${encodeURIComponent(providerId)}`),
  };
}
