/**
 * Model store - providers, models, active model, switch operations.
 */

import { createSignal } from 'solid-js';
import type { ProviderEntry, ModelOption } from '@/types/index.js';
import { getGateway, getModelAdapter } from './context.js';
import { api } from '../services/api/router';
import type { Provider } from '../services/api/types';

const MODEL_PROVIDER_CACHE_KEY = 'hermes.desktop.model.providers.v1';

const [providers, setProviders] = createSignal<ProviderEntry[]>([]);
const [activeProvider, setActiveProvider] = createSignal<string | null>(null);
const [activeModel, setActiveModel] = createSignal<string | null>(null);
const [isLoading, setIsLoading] = createSignal(false);
const [error, setError] = createSignal<string | null>(null);

// View navigation state machine
export type ModelView = 'hub' | 'add-provider' | 'provider-detail' | 'model-detail';
const [currentView, setCurrentView] = createSignal<ModelView>('hub');
const [previousView, setPreviousView] = createSignal<ModelView>('hub');
const [detailProviderName, setDetailProviderName] = createSignal<string | null>(null);
const [detailModelName, setDetailModelName] = createSignal<string | null>(null);
// Draft provider set when navigating from Add Provider without saving.
// ProviderModelsView uses it as fallback when the provider isn't in the configured list.
const [draftProvider, setDraftProvider] = createSignal<CatalogProvider | null>(null);

// Catalog of built-in providers available for adding (offline fallback)
export interface BuiltInProvider {
  name: string;
  category: 'popular' | 'local';
  description: string;
}

export const BUILT_IN_PROVIDERS: BuiltInProvider[] = [
  { name: 'OpenAI', category: 'popular', description: 'GPT-4, GPT-3.5 series' },
  { name: 'Anthropic', category: 'popular', description: 'Claude 3 & 4 series' },
  { name: 'Google', category: 'popular', description: 'Gemini 1.5 & 2.0 series' },
  { name: 'DeepSeek', category: 'popular', description: 'DeepSeek-V3, R1' },
  { name: 'Ollama', category: 'local', description: 'Local LLM runner' },
  { name: 'LM Studio', category: 'local', description: 'Desktop LLM GUI' },
  { name: 'vLLM', category: 'local', description: 'High-throughput inference' },
];

/** A provider entry from the full catalog (configured_only=false). */
export interface CatalogProvider {
  id: string;
  name: string;
  auth?: string | null;
  auth_type?: string | null;
  is_current?: boolean;
  has_overlay?: boolean;
  modelCount: number;
  base_url?: string;
  api_key_env?: string;
  api_key_set?: boolean;
  display_name?: string;
}

export const modelStore = {
  get providers() { return providers(); },
  get activeProvider() { return activeProvider(); },
  get activeModel() { return activeModel(); },
  get isLoading() { return isLoading(); },
  get error() { return error(); },

  get activeProviderEntry(): ProviderEntry | null {
    const ap = activeProvider();
    if (!ap) return null;
    return providers().find(p => p.name === ap) ?? null;
  },

  get activeModelOption(): ModelOption | null {
    const provider = this.activeProviderEntry;
    const model = activeModel();
    if (!provider || !model) return null;
    return provider.models?.find(m => m.name === model) ?? null;
  },

  /** Populate providers from external data (e.g., sidecar in standalone mode). */
  hydrateProviders(entries: ProviderEntry[]): void {
    setProviders(entries);
  },

  hydrateActiveModel(provider: string | null, model: string | null): void {
    setActiveProvider(provider);
    setActiveModel(model);
  },

  async loadModels(): Promise<void> {
    const adapter = getModelAdapter();
    if (!adapter) return;
    setIsLoading(true);
    setError(null);
    try {
      const list = await adapter.loadProviders();
      setProviders(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load models');
    } finally {
      setIsLoading(false);
    }
  },

  async loadActiveModel(): Promise<void> {
    const adapter = getModelAdapter();
    if (!adapter) return;
    try {
      const active = await adapter.loadActiveModel();
      setActiveProvider(active?.provider ?? null);
      setActiveModel(active?.model ?? null);
    } catch {
      setActiveProvider(null);
      setActiveModel(null);
    }
  },

  async switchModel(providerName: string, modelName: string): Promise<boolean> {
    setActiveProvider(providerName);
    setActiveModel(modelName);
    setError(null);
    setIsLoading(true);
    try {
      await api.model().setActiveModel(providerName, modelName);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to switch model');
      return false;
    } finally {
      setIsLoading(false);
    }
  },

  async upsertProvider(input: {
    name: string;
    is_builtin: boolean;
    base_url?: string;
    api_key?: string;
    api_key_env?: string;
    display_name?: string;
  }): Promise<void> {
    const adapter = getModelAdapter();
    // Always save to overlay API so standalone mode works.
    try {
      const id = modelsStore.resolveId(input.name);
      const patch: Record<string, string | boolean | null> = {
        base_url: input.base_url ?? null,
        api_key_env: input.api_key_env ?? null,
        display_name: input.display_name ?? null,
      };
      if (input.api_key !== undefined) {
        patch.api_key = input.api_key;
      }
      await api.overlays().patch('model', id, patch);
    } catch {
      void 0;
    }
    // Also try the gateway adapter if available.
    if (adapter) {
      try {
        await adapter.upsertProvider(input);
      } catch {
        void 0;
      }
    }
    await modelsStore.load();
  },

  async deleteProvider(name: string, isBuiltin: boolean): Promise<void> {
    const id = modelsStore.resolveId(name);
    await api.model().deleteProvider(id);
    const adapter = getModelAdapter();
    if (adapter) {
      try { await adapter.deleteProvider(name, isBuiltin); } catch { void 0; }
    }
    await modelsStore.load();
  },

  async setProviderEnabled(name: string, enabled: boolean): Promise<void> {
    const adapter = getModelAdapter();
    try {
      const id = modelsStore.resolveId(name);
      await api.overlays().patch('model', id, { visible: enabled });
    } catch {
      void 0;
    }
    if (adapter) {
      try {
        await adapter.setProviderEnabled(name, enabled);
      } catch {
        void 0;
      }
    }
    await modelsStore.load();
  },

  async setModelEnabled(provider: string, model: string, enabled: boolean): Promise<void> {
    const adapter = getModelAdapter();
    if (!adapter) return;
    await adapter.setModelEnabled(provider, model, enabled);
    await this.loadModels();
  },

  computeFallbackModel(disabledProvider: string, disabledModel: string) {
    const adapter = getModelAdapter();
    if (!adapter) return null;
    return adapter.computeFallbackModel(providers(), disabledProvider, disabledModel);
  },

  get currentView() { return currentView(); },
  get detailProviderName() { return detailProviderName(); },
  get detailModelName() { return detailModelName(); },
  get draftProvider() { return draftProvider(); },
  setDraftProvider(p: CatalogProvider | null) { setDraftProvider(p); },

  get detailProviderEntry(): ProviderEntry | null {
    const name = detailProviderName();
    if (!name) return null;
    return providers().find(p => p.name === name) ?? null;
  },

  get detailModelOption(): ModelOption | null {
    const provider = this.detailProviderEntry;
    const modelName = detailModelName();
    if (!provider || !modelName) return null;
    return provider.models?.find(m => m.name === modelName) ?? null;
  },

  navigateTo(view: ModelView): void {
    setPreviousView(currentView());
    setCurrentView(view);
    setDraftProvider(null);
    if (view === 'hub') {
      setDetailProviderName(null);
      setDetailModelName(null);
    }
  },

  openProviderDetail(providerName: string): void {
    setPreviousView(currentView());
    setDetailProviderName(providerName);
    setDetailModelName(null);
    setCurrentView('provider-detail');
  },

  openModelDetail(providerName: string, modelName: string): void {
    setPreviousView(currentView());
    setDetailProviderName(providerName);
    setDetailModelName(modelName);
    setCurrentView('model-detail');
  },

  goBack(): void {
    if (currentView() === 'model-detail' && detailProviderName()) {
      setDetailModelName(null);
      setCurrentView('provider-detail');
    } else {
      const prev = previousView();
      setCurrentView(prev);
      setDetailProviderName(null);
      setDetailModelName(null);
      setDraftProvider(null);
    }
  },

  clearError() {
    setError(null);
  },
};

/** Per-1M-token pricing for well-known models (USD). */
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'claude-opus-4-7': { input: 15.0, output: 75.0 },
  'claude-sonnet-4-6': { input: 3.0, output: 15.0 },
  'claude-haiku-4-5': { input: 0.8, output: 4.0 },
  'gpt-5': { input: 2.5, output: 10.0 },
  'gpt-4o': { input: 2.5, output: 10.0 },
  'deepseek-v3': { input: 0.27, output: 1.1 },
  'deepseek-r1': { input: 0.55, output: 2.19 },
};

function mapModelOption(raw: Record<string, unknown>): ModelOption {
  const id = (raw.id ?? raw.name ?? '') as string;
  const pricing = MODEL_PRICING[id];
  return {
    name: id,
    display_name: id,
    context_length: (raw.context_window ?? raw.context_length) as number | undefined,
    supports_vision: (raw.supports_vision ?? false) as boolean,
    supports_function_calling: (raw.supports_function_calling ?? false) as boolean,
    supports_streaming: (raw.supports_streaming ?? true) as boolean,
    pricing_input: (raw.pricing_input as number) ?? pricing?.input,
    pricing_output: (raw.pricing_output as number) ?? pricing?.output,
    enabled: true,
  };
}

function mapProvider(apiProvider: Provider): ProviderEntry {
  const d = apiProvider.desktop;
  return {
    name: apiProvider.id,
    display_name: d.display_name ?? apiProvider.name,
    is_builtin: true,
    enabled: d.visible !== false,
    has_overlay: apiProvider.has_overlay ?? false,
    base_url: d.base_url ?? undefined,
    api_key: d.api_key ?? undefined,
    api_key_env: d.api_key_env ?? undefined,
    api_key_set: d.api_key_set ?? Boolean(d.api_key || d.api_key_env),
    api_key_preview: d.api_key_preview ?? undefined,
    api_key_source: d.api_key_source ?? undefined,
    base_url_source: d.base_url_source ?? undefined,
    models: (apiProvider.models ?? []).map(mapModelOption),
  };
}

function mapCatalogProvider(apiProvider: Provider): CatalogProvider {
  const d = apiProvider.desktop;
  return {
    id: apiProvider.id,
    name: apiProvider.name,
    auth: apiProvider.auth ?? null,
    auth_type: (apiProvider.auth as string) ?? null,
    is_current: apiProvider.is_current ?? undefined,
    has_overlay: apiProvider.has_overlay ?? false,
    modelCount: (apiProvider.models ?? []).length,
    base_url: d.base_url ?? undefined,
    api_key_env: d.api_key_env ?? undefined,
    api_key_set: d.api_key_set ?? Boolean(d.api_key || d.api_key_env),
    display_name: d.display_name ?? undefined,
  };
}

function readCachedProviders(): Provider[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(MODEL_PROVIDER_CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed as Provider[];
  } catch {
    return [];
  }
}

function writeCachedProviders(nextProviders: Provider[]): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(MODEL_PROVIDER_CACHE_KEY, JSON.stringify(nextProviders));
  } catch {
    void 0;
  }
}

const CATALOG_CACHE_KEY = 'hermes.desktop.model.catalog.v1';

function readCachedCatalog(): CatalogProvider[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(CATALOG_CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed as CatalogProvider[];
  } catch {
    return [];
  }
}

function writeCachedCatalog(next: CatalogProvider[]): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(CATALOG_CACHE_KEY, JSON.stringify(next));
  } catch {
    void 0;
  }
}

/**
 * Factory for creating a models store sourced from the services/api layer.
 * Maps sidecar Provider -> ProviderEntry so the UI components work without
 * a connected gateway.
 */
export function createModelsStore() {
  const initialProviders = readCachedProviders();
  const [rawProviders, setRawProviders] = createSignal<Provider[]>(initialProviders);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<Error | null>(null);
  const [hasLoaded, setHasLoaded] = createSignal(initialProviders.length > 0);

  // Catalog state for AddProviderView (all providers, not just configured)
  const initialCatalog = readCachedCatalog();
  const [catalogProviders, setCatalogProviders] = createSignal<CatalogProvider[]>(initialCatalog);
  const [catalogLoading, setCatalogLoading] = createSignal(false);
  const [catalogHasLoaded, setCatalogHasLoaded] = createSignal(initialCatalog.length > 0);

  if (initialProviders.length > 0) {
    const configured = initialProviders.filter(p => p.has_overlay === true);
    modelStore.hydrateProviders(configured.map(mapProvider));
  }

  const providers = () => rawProviders().map(mapProvider);

  /** Resolve provider catalog ID from display name. */
  const resolveId = (name: string): string => {
    const raw = rawProviders();
    const found = raw.find((p) => p.name === name);
    return found?.id ?? name.toLowerCase();
  };

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await api.model().listProviders();
      setRawProviders(resp.items);
      modelStore.hydrateProviders(resp.items.map(mapProvider));
      writeCachedProviders(resp.items);
      setHasLoaded(true);
    } catch (e) {
      setError(e as Error);
      setHasLoaded(true);
    } finally {
      setLoading(false);
    }
  };

  /** Load the full provider catalog (including unconfigured providers).
   *  Used by AddProviderView to show all available providers. */
  const loadCatalog = async () => {
    setCatalogLoading(true);
    try {
      const resp = await api.model().listProviders({ configuredOnly: false });
      const mapped = resp.items.map(mapCatalogProvider);
      setCatalogProviders(mapped);
      writeCachedCatalog(mapped);
      setCatalogHasLoaded(true);
    } catch (e) {
      console.error('[modelsStore] loadCatalog failed:', e);
      setCatalogHasLoaded(true);
    } finally {
      setCatalogLoading(false);
    }
  };

  // NOTE: modelStore.loadActiveModel() (gateway path) also writes to the same
  // activeProvider/activeModel signals. loadActive() uses the sidecar HTTP
  // transport instead. Both paths co-exist during the standalone refactor;
  // the gateway path will be removed once standalone mode is fully wired.
  const loadActive = async () => {
    try {
      const active = await api.model().getActiveModel();
      modelStore.hydrateActiveModel(active.provider, active.model);
    } catch (err) {
      console.error('[modelsStore] loadActive failed:', err);
      modelStore.hydrateActiveModel(null, null);
    }
  };

  const revealProviderApiKey = async (provider: string) => {
    const response = await api.model().revealProviderApiKey(provider);
    return response.api_key;
  };

  return {
    providers,
    loading,
    error,
    hasLoaded,
    load,
    loadActive,
    loadCatalog,
    catalogProviders,
    catalogLoading,
    catalogHasLoaded,
    revealProviderApiKey,
    resolveId,
  };
}

/** Singleton instance used by the model module views. */
export const modelsStore = createModelsStore();
