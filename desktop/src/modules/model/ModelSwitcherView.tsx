import type { Component } from 'solid-js';
import {
  createSignal,
  createEffect,
  createMemo,
  onMount,
  Show,
  For,
  Switch,
  Match,
} from 'solid-js';
import { modelStore } from '@/stores/models.js';
import { LoadingSpinner } from '@/components/LoadingSpinner.js';
import { Tabs } from '@/components/Tabs.js';
import { ProviderCard } from './ProviderCard.js';
import { ModelComparison } from './ModelComparison.js';
import { ModelSearch } from './ModelSearch.js';
import { ConfigureProviderModal } from './ConfigureProviderModal.js';
import { EmptyProviders } from './EmptyProviders.js';
import { AddProviderView } from './AddProviderView.js';
import { ProviderModelsView } from './ProviderModelsView.js';
import { ModelDetailView } from './ModelDetailView.js';
import type { ProviderEntry } from '@/types/index.js';
import styles from './ModelSwitcherView.module.css';

export const ModelSwitcherView: Component = () => {
  const [searchQuery, setSearchQuery] = createSignal('');
  const [selectedProvider, setSelectedProvider] = createSignal<string | null>(null);
  const [configuringProvider, setConfiguringProvider] = createSignal<ProviderEntry | null>(null);
  const [activeTab, setActiveTab] = createSignal('providers');

  onMount(() => {
    modelStore.loadModels();
    modelStore.loadActiveModel();
  });

  createEffect(() => {
    if (modelStore.activeProvider && !selectedProvider()) {
      setSelectedProvider(modelStore.activeProvider);
    }
  });

  const filteredProviders = createMemo<ProviderEntry[]>(() => {
    const query = searchQuery().toLowerCase();
    const allProviders = modelStore.providers;
    if (!query) return allProviders;
    return allProviders.filter((p) => {
      const nameMatch = p.name.toLowerCase().includes(query);
      const modelMatch = (p.models ?? []).some(
        (m) =>
          m.name.toLowerCase().includes(query) ||
          (m.display_name ?? '').toLowerCase().includes(query),
      );
      return nameMatch || modelMatch;
    });
  });

  const filteredProviderEntries = createMemo<ProviderEntry[]>(() => {
    const selected = selectedProvider();
    if (!selected) return filteredProviders();
    return filteredProviders().filter((p) => p.name === selected);
  });

  const totalModelCount = () =>
    modelStore.providers.reduce((sum, p) => sum + (p.models?.length ?? 0), 0);

  const filteredModelCount = () =>
    filteredProviders().reduce((sum, p) => sum + (p.models?.length ?? 0), 0);

  const handleSelectModel = async (providerName: string, modelName: string) => {
    await modelStore.switchModel(providerName, modelName);
  };

  const handleConfigureProvider = (provider: ProviderEntry) => {
    setConfiguringProvider(provider);
  };

  const handleCloseModal = () => {
    setConfiguringProvider(null);
  };

  const handleSaveProvider = (updated: ProviderEntry) => {
    modelStore.upsertProvider({ name: updated.name, is_builtin: updated.is_builtin ?? false, base_url: updated.base_url, api_key: updated.api_key, api_key_env: updated.api_key_env, display_name: updated.display_name });
    setConfiguringProvider(null);
  };

  return (
    <Switch>
      <Match when={modelStore.currentView === 'add-provider'}>
        <AddProviderView />
      </Match>
      <Match when={modelStore.currentView === 'provider-detail'}>
        <ProviderModelsView />
      </Match>
      <Match when={modelStore.currentView === 'model-detail'}>
        <ModelDetailView />
      </Match>
      <Match when={modelStore.currentView === 'hub'}>
        <div class={styles.container}>
          <Show when={modelStore.isLoading && modelStore.providers.length === 0}>
            <div class={styles.loading}>
              <LoadingSpinner size="lg" />
            </div>
          </Show>

          <Show
            when={!modelStore.isLoading && modelStore.providers.length === 0}
          >
            <EmptyProviders />
          </Show>

          <Show when={modelStore.providers.length > 0}>
            <div class={styles.tabsRow}>
              <Tabs
                tabs={[
                  { id: 'providers', label: 'Providers' },
                  { id: 'models', label: 'Models' },
                ]}
                activeTab={activeTab()}
                onChange={setActiveTab}
              />
            </div>

            <Show when={activeTab() === 'providers'}>
              <section class={styles.providersSection}>
                <div class={styles.providerGrid}>
                  <For each={filteredProviders()}>
                    {(provider) => (
                      <ProviderCard
                        provider={provider}
                        modelCount={provider.models?.length ?? 0}
                        isActive={modelStore.activeProvider === provider.name}
                        onClick={() =>
                          modelStore.openProviderDetail(provider.name)
                        }
                        onConfigure={() => handleConfigureProvider(provider)}
                      />
                    )}
                  </For>
                </div>
              </section>
            </Show>

            <Show when={activeTab() === 'models'}>
              <section class={styles.searchSection}>
                <ModelSearch
                  value={searchQuery()}
                  onChange={setSearchQuery}
                  resultCount={filteredModelCount()}
                  totalCount={totalModelCount()}
                />
              </section>

              <section class={styles.comparison}>
                <ModelComparison
                  providers={filteredProviders()}
                  activeProvider={modelStore.activeProvider}
                  activeModel={modelStore.activeModel}
                  onSelectModel={handleSelectModel}
                />
              </section>
            </Show>
          </Show>

          <Show when={modelStore.error}>
            <div class={styles.error}>{modelStore.error}</div>
          </Show>

          <ConfigureProviderModal
            open={!!configuringProvider()}
            provider={configuringProvider()}
            onClose={handleCloseModal}
            onSave={handleSaveProvider}
          />
        </div>
      </Match>
    </Switch>
  );
};
