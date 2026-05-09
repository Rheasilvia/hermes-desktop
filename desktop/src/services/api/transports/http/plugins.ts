import type { HttpClient } from '../../http-client';
import type {
  PluginHubResponse,
  PluginInstallRequest,
  PluginInstallResponse,
  PluginProvidersRequest,
  PluginVisibilityRequest,
} from '../../types';

export interface PluginsTransport {
  getHub(): Promise<PluginHubResponse>;
  rescan(): Promise<{ ok: boolean; count: number }>;
  install(body: PluginInstallRequest): Promise<PluginInstallResponse>;
  enable(name: string): Promise<{ ok: boolean }>;
  disable(name: string): Promise<{ ok: boolean }>;
  update(name: string): Promise<{ ok: boolean }>;
  remove(name: string): Promise<{ ok: boolean }>;
  saveProviders(body: PluginProvidersRequest): Promise<{ ok: boolean }>;
  setVisibility(name: string, hidden: boolean): Promise<{ ok: boolean }>;
}

const BASE = '/desktop/api/plugins';

export function makePluginsTransport(client: HttpClient): PluginsTransport {
  return {
    getHub: () => client.get<PluginHubResponse>(`${BASE}/hub`),
    rescan: () => client.get<{ ok: boolean; count: number }>(`${BASE}/rescan`),
    install: (body) => client.post<PluginInstallResponse>(`${BASE}/install`, body),
    enable: (name) => client.post<{ ok: boolean }>(`${BASE}/${encodeURIComponent(name)}/enable`, {}),
    disable: (name) => client.post<{ ok: boolean }>(`${BASE}/${encodeURIComponent(name)}/disable`, {}),
    update: (name) => client.post<{ ok: boolean }>(`${BASE}/${encodeURIComponent(name)}/update`, {}),
    remove: (name) => client.delete<{ ok: boolean }>(`${BASE}/${encodeURIComponent(name)}`),
    saveProviders: (body: PluginProvidersRequest) =>
      client.put<{ ok: boolean }>(`${BASE}/providers`, body),
    setVisibility: (name, hidden) =>
      client.put<{ ok: boolean }>(`${BASE}/${encodeURIComponent(name)}/visibility`, { hidden } satisfies PluginVisibilityRequest),
  };
}
