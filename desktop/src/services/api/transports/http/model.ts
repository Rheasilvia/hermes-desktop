import type { HttpClient } from '../../http-client';
import type { ListResponse, Provider } from '../../types';

export interface ModelTransport {
  listProviders(): Promise<ListResponse<Provider>>;
  getCatalog(): Promise<{ providers: Provider[]; fetched_at: string | null }>;
  getActiveModel(): Promise<{ provider: string | null; model: string | null }>;
  setActiveModel(provider: string, model: string): Promise<void>;
}

export function makeModelTransport(c: HttpClient): ModelTransport {
  return {
    listProviders: () =>
      c.get<ListResponse<Provider>>('/desktop/api/model/providers'),
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
  };
}
