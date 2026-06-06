/**
 * Model store - providers, models, active model, switch operations.
 */

import { createSignal } from 'solid-js';
import type { ProviderEntry, ModelOption } from '@/types/index.js';
import { api } from '../services/api/router';
import type { Provider } from '../services/api/types';

const MODEL_PROVIDER_CACHE_KEY = 'hermes.desktop.model.providers.v2';

// ── Global default model (the "main" model, settings-only) ────────────────
// Never mutated by session switches. Source of truth = config.yaml via
// api.model().getActiveModel(). Per-session overrides live in sessionStore.
const [defaultProvider, setDefaultProvider] = createSignal<string | null>(null);
const [defaultModel, setDefaultModel] = createSignal<string | null>(null);

// View navigation state machine
export type ModelView = 'hub' | 'add-provider' | 'provider-detail' | 'model-detail';
const [currentView, setCurrentView] = createSignal<ModelView>('hub');
const [previousView, setPreviousView] = createSignal<ModelView>('hub');
const [detailProviderName, setDetailProviderName] = createSignal<string | null>(null);
const [detailModelName, setDetailModelName] = createSignal<string | null>(null);
// Draft provider set when navigating from Add Provider without saving.
const [draftProvider, setDraftProvider] = createSignal<CatalogProvider | null>(null);

// Shared error/loading for global switch operations
const [switchError, setSwitchError] = createSignal<string | null>(null);
const [switchLoading, setSwitchLoading] = createSignal(false);

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
  oauth_logged_in?: boolean;
  modelCount: number;
  base_url?: string;
  api_key_env?: string;
  api_key_set?: boolean;
  display_name?: string;
}

export interface SwitchModelOpts {
  scope: 'global' | 'session';
  sessionId?: string;
}

export const modelStore = {
  // Global default model — only written by global switches / loadActive
  get defaultProvider() { return defaultProvider(); },
  get defaultModel() { return defaultModel(); },

  // Legacy accessors kept for callers that still use activeProvider/activeModel.
  // These read the global default; per-session consumers should call
  // sessionStore.getSessionModel(sid) directly instead.
  get activeProvider() { return defaultProvider(); },
  get activeModel() { return defaultModel(); },

  get isLoading() { return switchLoading(); },
  get error() { return switchError(); },

  get activeProviderEntry(): ProviderEntry | null {
    const ap = defaultProvider();
    if (!ap) return null;
    return modelsStore.providers().find(p => p.name === ap) ?? null;
  },

  get activeModelOption(): ModelOption | null {
    const provider = this.activeProviderEntry;
    const model = defaultModel();
    if (!provider || !model) return null;
    return provider.models?.find(m => m.name === model) ?? null;
  },

  hydrateDefaultModel(provider: string | null, model: string | null): void {
    setDefaultProvider(provider);
    setDefaultModel(model);
  },

  /** @deprecated Use hydrateDefaultModel instead */
  hydrateActiveModel(provider: string | null, model: string | null): void {
    this.hydrateDefaultModel(provider, model);
  },

  /** @deprecated Catalog is now loaded via modelsStore directly */
  async loadModels(): Promise<void> {
    await modelsStore.load();
  },

  /** @deprecated Use modelsStore.loadActive() */
  async loadActiveModel(): Promise<void> {
    await modelsStore.loadActive();
  },

  /**
   * Switch model. scope='global' changes the main default (persisted to config.yaml).
   * scope='session' updates only the given session (no global mutation).
   */
  async switchModel(
    providerName: string,
    modelName: string,
    persistGlobally: boolean | SwitchModelOpts = true,
  ): Promise<boolean> {
    const opts: SwitchModelOpts =
      typeof persistGlobally === 'boolean'
        ? { scope: persistGlobally ? 'global' : 'session' }
        : persistGlobally;

    setSwitchError(null);

    if (opts.scope === 'global') {
      // Optimistic update
      const prevProvider = defaultProvider();
      const prevModel = defaultModel();
      setDefaultProvider(providerName);
      setDefaultModel(modelName);
      setSwitchLoading(true);
      try {
        await api.model().setActiveModel(providerName, modelName);
        modelsStore.invalidate();
        return true;
      } catch (e) {
        // Rollback
        setDefaultProvider(prevProvider);
        setDefaultModel(prevModel);
        setSwitchError(e instanceof Error ? e.message : 'Failed to switch model');
        return false;
      } finally {
        setSwitchLoading(false);
      }
    }

    // scope='session': caller (ModelSelector) handles optimistic + backend update.
    // modelStore is not mutated; sessionStore.setSessionModel is called by the caller.
    return true;
  },

  async upsertProvider(input: {
    name: string;
    is_builtin: boolean;
    base_url?: string;
    api_key?: string;
    api_key_env?: string;
    display_name?: string;
  }): Promise<void> {
    const id = modelsStore.resolveId(input.name);
    const patch: Record<string, string | boolean | null> = {
      base_url: input.base_url ?? null,
      api_key_env: input.api_key_env ?? null,
      display_name: input.display_name ?? null,
    };
    if (input.api_key !== undefined) {
      patch.api_key = input.api_key;
    }
    try {
      await api.overlays().patch('model', id, patch);
    } catch {
      void 0;
    }
    modelsStore.invalidate();
    await modelsStore.load();
  },

  async deleteProvider(name: string, isBuiltin: boolean): Promise<void> {
    const id = modelsStore.resolveId(name);
    await api.model().deleteProvider(id);
    modelsStore.invalidate();
    await modelsStore.load();
  },

  async setProviderEnabled(name: string, enabled: boolean): Promise<void> {
    const id = modelsStore.resolveId(name);
    try {
      await api.overlays().patch('model', id, { visible: enabled });
    } catch {
      void 0;
    }
    modelsStore.invalidate();
    await modelsStore.load();
  },

  async setModelEnabled(provider: string, model: string, enabled: boolean): Promise<void> {
    const id = modelsStore.resolveId(provider);
    // Retrieve current models_config blob, update the target model, re-patch.
    // Backend B3 will extend this; for now we store enabled state in the
    // provider overlay as a JSON blob keyed by model name.
    try {
      const current = await api.model().getProviderModelsConfig(id);
      const updated = { ...(current ?? {}), [model]: { ...(current?.[model] ?? {}), enabled } };
      await api.overlays().patch('model', id, { models_config: JSON.stringify(updated) });
    } catch {
      void 0;
    }
    modelsStore.invalidate();
    await modelsStore.load();
  },

  get currentView() { return currentView(); },
  get detailProviderName() { return detailProviderName(); },
  get detailModelName() { return detailModelName(); },
  get draftProvider() { return draftProvider(); },
  setDraftProvider(p: CatalogProvider | null) { setDraftProvider(p); },

  get detailProviderEntry(): ProviderEntry | null {
    const name = detailProviderName();
    if (!name) return null;
    return modelsStore.providers().find(p => p.name === name) ?? null;
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
    setSwitchError(null);
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
  // Read enabled from overlay field — NOT hardcoded true
  const enabled = raw.enabled !== undefined ? Boolean(raw.enabled) : true;
  return {
    name: id,
    display_name: id,
    context_length: (raw.context_window ?? raw.context_length) as number | undefined,
    supports_vision: (raw.supports_vision ?? false) as boolean,
    supports_function_calling: (raw.supports_function_calling ?? false) as boolean,
    supports_streaming: (raw.supports_streaming ?? true) as boolean,
    pricing_input: (raw.pricing_input as number) ?? pricing?.input,
    pricing_output: (raw.pricing_output as number) ?? pricing?.output,
    default_temperature: (raw.default_temperature as number) ?? undefined,
    default_max_tokens: (raw.default_max_tokens as number) ?? undefined,
    enabled,
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

const CATALOG_CACHE_KEY = 'hermes.desktop.model.catalog.v2';

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
 * Sole source of truth for the provider/model catalog. All pickers and
 * settings views read from here — no second load path exists.
 */
export function createModelsStore() {
  const initialProviders = readCachedProviders();
  const [rawProviders, setRawProviders] = createSignal<Provider[]>(initialProviders);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<Error | null>(null);
  const [hasLoaded, setHasLoaded] = createSignal(initialProviders.length > 0);
  // Stale flag: set by invalidate() to trigger background refetch
  const [isStale, setIsStale] = createSignal(false);
  // In-flight dedup: concurrent load() calls share one promise
  let loadPromise: Promise<void> | null = null;

  // Catalog state for AddProviderView
  const initialCatalog = readCachedCatalog();
  const [catalogProviders, setCatalogProviders] = createSignal<CatalogProvider[]>(initialCatalog);
  const [catalogLoading, setCatalogLoading] = createSignal(false);
  const [catalogHasLoaded, setCatalogHasLoaded] = createSignal(initialCatalog.length > 0);

  // Don't hydrate default model from cache — let loadActive() be authoritative

  const providers = () => rawProviders().map(mapProvider);

  const resolveId = (name: string): string => {
    const raw = rawProviders();
    const found = raw.find((p) => p.name === name);
    return found?.id ?? name.toLowerCase();
  };

  const load = async (): Promise<void> => {
    // In-flight dedup: return the existing promise if a load is already running
    if (loadPromise) return loadPromise;
    // Skip if fresh (loaded recently and not stale)
    if (hasLoaded() && !isStale()) return;

    loadPromise = (async () => {
      setLoading(true);
      setError(null);
      try {
        const resp = await api.model().listProviders();
        setRawProviders(resp.items);
        writeCachedProviders(resp.items);
        setHasLoaded(true);
        setIsStale(false);
      } catch (e) {
        setError(e as Error);
        setHasLoaded(true);
      } finally {
        setLoading(false);
        loadPromise = null;
      }
    })();

    return loadPromise;
  };

  /** Mark catalog stale; next load() call will refetch. Does NOT clear current data. */
  const invalidate = (): void => {
    setIsStale(true);
  };

  /** Load the full provider catalog (including unconfigured providers). */
  const loadCatalog = async () => {
    setCatalogLoading(true);
    try {
      const resp = await api.model().listProviders({ configuredOnly: false });
      const mapped = resp.items.map(mapCatalogProvider);

      try {
        const oauthProviders = await api.oauth().listProviders();
        const oauthLoggedIn: Record<string, boolean> = {};
        for (const op of oauthProviders) {
          if (op.logged_in) oauthLoggedIn[op.id] = true;
        }
        for (const p of mapped) {
          if (oauthLoggedIn[p.id]) p.oauth_logged_in = true;
        }
      } catch {
        // OAuth endpoint unavailable — leave oauth_logged_in as undefined
      }

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

  const loadActive = async () => {
    try {
      const active = await api.model().getActiveModel();
      modelStore.hydrateDefaultModel(active.provider, active.model);
    } catch (err) {
      console.error('[modelsStore] loadActive failed:', err);
      modelStore.hydrateDefaultModel(null, null);
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
    invalidate,
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

