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

  async loadModels(): Promise<void> {
    const adapter = getModelAdapter();
    if (!adapter) {
      const gateway = getGateway();
      if (!gateway) {
        setProviders([]);
        setError('Gateway not connected');
        return;
      }
    }
    if (!adapter) {
      setProviders([]);
      setError('Gateway not connected');
      return;
    }
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
    if (!adapter) throw new Error('Gateway not connected');
    await adapter.upsertProvider(input);
    await this.loadModels();
  },

  async deleteProvider(name: string, isBuiltin: boolean): Promise<void> {
    const adapter = getModelAdapter();
    if (!adapter) throw new Error('Gateway not connected');
    await adapter.deleteProvider(name, isBuiltin);
    await this.loadModels();
  },

  async setProviderEnabled(name: string, enabled: boolean): Promise<void> {
    const adapter = getModelAdapter();
    if (!adapter) return;
    await adapter.setProviderEnabled(name, enabled);
    await this.loadModels();
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

/**
 * Factory for creating a models store sourced from the services/api layer.
 * Provides an alternative data path through api.model() while the existing
 * module-level store continues to use getModelAdapter().
 */
export function createModelsStore() {
  const [providers, setProviders] = createSignal<Provider[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<Error | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await api.model().listProviders();
      setProviders(resp.items);
    } catch (e) {
      setError(e as Error);
    } finally {
      setLoading(false);
    }
  };

  return { providers, loading, error, load };
}
