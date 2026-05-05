/**
 * Model store - providers, models, active model, switch operations.
 */

import { createSignal } from 'solid-js';
import type { ProviderEntry, ModelOption } from '@/types/index.js';
import { getGateway, getModelAdapter } from './context.js';
import { api } from '../services/api/router';
import type { Provider } from '../services/api/types';

const [providers, setProviders] = createSignal<ProviderEntry[]>([]);
const [activeProvider, setActiveProvider] = createSignal<string | null>(null);
const [activeModel, setActiveModel] = createSignal<string | null>(null);
const [isLoading, setIsLoading] = createSignal(false);
const [error, setError] = createSignal<string | null>(null);

// View navigation state machine
export type ModelView = 'hub' | 'add-provider' | 'provider-detail' | 'model-detail';
const [currentView, setCurrentView] = createSignal<ModelView>('hub');
const [detailProviderName, setDetailProviderName] = createSignal<string | null>(null);
const [detailModelName, setDetailModelName] = createSignal<string | null>(null);

// Catalog of built-in providers available for adding
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
    const adapter = getModelAdapter();
    setActiveProvider(providerName);
    setActiveModel(modelName);
    setError(null);
    if (!adapter) return true;
    setIsLoading(true);
    try {
      await adapter.setActiveModel(providerName, modelName);
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
    // Always save to overlay API so standalone mode works even when
    // a mock gateway is present (browser dev).
    try {
      const id = modelsStore.resolveId(input.name);
      await api.overlays().patch('model', id, {
        base_url: input.base_url ?? null,
        api_key: input.api_key ?? null,
        api_key_env: input.api_key_env ?? null,
        display_name: input.display_name ?? null,
      });
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
    const adapter = getModelAdapter();
    if (!adapter) throw new Error('Gateway not connected');
    await adapter.deleteProvider(name, isBuiltin);
    await this.loadModels();
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
    setCurrentView(view);
    if (view === 'hub') {
      setDetailProviderName(null);
      setDetailModelName(null);
    }
  },

  openProviderDetail(providerName: string): void {
    setDetailProviderName(providerName);
    setDetailModelName(null);
    setCurrentView('provider-detail');
  },

  openModelDetail(providerName: string, modelName: string): void {
    setDetailProviderName(providerName);
    setDetailModelName(modelName);
    setCurrentView('model-detail');
  },

  goBack(): void {
    if (currentView() === 'model-detail' && detailProviderName()) {
      setDetailModelName(null);
      setCurrentView('provider-detail');
    } else {
      setCurrentView('hub');
      setDetailProviderName(null);
      setDetailModelName(null);
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
    name: apiProvider.name,
    display_name: d.display_name ?? apiProvider.name,
    is_builtin: true,
    enabled: d.visible !== false,
    base_url: d.base_url ?? undefined,
    api_key: d.api_key ?? undefined,
    api_key_env: d.api_key_env ?? undefined,
    models: (apiProvider.models ?? []).map(mapModelOption),
  };
}

/**
 * Factory for creating a models store sourced from the services/api layer.
 * Maps sidecar Provider → ProviderEntry so the UI components work without
 * a connected gateway.
 */
export function createModelsStore() {
  const [rawProviders, setRawProviders] = createSignal<Provider[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<Error | null>(null);

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
    } catch (e) {
      setError(e as Error);
    } finally {
      setLoading(false);
    }
  };

  return { providers, loading, error, load, resolveId };
}

/** Singleton instance used by the model module views. */
export const modelsStore = createModelsStore();
