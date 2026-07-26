import type { HttpClient } from '../../http-client';
import type { ListResponse, Provider } from '../../types';

export interface AuxTaskEntry {
  task: string;
  provider: string;
  model: string;
  base_url: string;
}

export interface AuxMainEntry {
  provider: string;
  model: string;
}

export interface AuxiliaryModelsResponse {
  tasks: AuxTaskEntry[];
  main: AuxMainEntry;
}

export interface StaleAuxEntry {
  task: string;
  provider: string;
  model: string;
}

export interface ModelAssignmentRequest {
  scope: 'main' | 'auxiliary';
  provider?: string;
  model?: string;
  task?: string;
  base_url?: string;
}

export interface ModelAssignmentResponse {
  ok: boolean;
  scope: string;
  provider?: string | null;
  model?: string | null;
  stale_aux?: StaleAuxEntry[];
  reset?: boolean | null;
  tasks?: string[] | null;
  gateway_tools?: string[];
}

export interface ModelTransport {
  listProviders(opts?: { configuredOnly?: boolean }): Promise<ListResponse<Provider>>;
  getCatalog(): Promise<{ providers: Provider[]; fetched_at: string | null }>;
  getActiveModel(): Promise<{ provider: string | null; model: string | null }>;
  setActiveModel(provider: string, model: string): Promise<void>;
  revealProviderApiKey(provider: string): Promise<{ provider: string; api_key: string; source: string }>;
  deleteProvider(providerId: string): Promise<void>;
  /** Returns per-model config blob stored in the provider overlay (models_config). */
  getProviderModelsConfig(providerId: string): Promise<Record<string, Record<string, unknown>> | null>;
  /** Persist per-model params (temperature, max_tokens, capabilities) via overlay. */
  setModelParams(providerId: string, modelId: string, params: Record<string, unknown>): Promise<void>;
  /** Return current auxiliary task model assignments. */
  getAuxiliaryModels(): Promise<AuxiliaryModelsResponse>;
  /** Assign a provider/model to the main slot or an auxiliary task slot. */
  setModelAssignment(req: ModelAssignmentRequest): Promise<ModelAssignmentResponse>;
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
    getProviderModelsConfig: async (providerId) => {
      try {
        const r = await c.get<{ models_config?: string }>(
          `/desktop/api/model/providers/${encodeURIComponent(providerId)}/models-config`,
        );
        if (!r.models_config) return null;
        return JSON.parse(r.models_config) as Record<string, Record<string, unknown>>;
      } catch {
        return null;
      }
    },
    setModelParams: (providerId, modelId, params) =>
      c.post<void>(
        `/desktop/api/model/providers/${encodeURIComponent(providerId)}/models/${encodeURIComponent(modelId)}/params`,
        params,
      ),
    getAuxiliaryModels: () =>
      c.get<AuxiliaryModelsResponse>('/desktop/api/model/auxiliary'),
    setModelAssignment: (req) =>
      c.post<ModelAssignmentResponse>('/desktop/api/model/assignment', req),
  };
}
