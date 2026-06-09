import type { Component } from 'solid-js';
import {
  createSignal,
  createEffect,
  onMount,
  Show,
  For,
  Switch,
  Match,
} from 'solid-js';
import { modelStore, modelsStore } from '@/stores/models.js';
import { Tabs } from '@/ui/molecules/Tabs.js';
import { ProviderCard } from './ProviderCard.js';
import { ModelUsageView } from './ModelUsageView.js';
import { MultimodalModelsView } from './MultimodalModelsView.js';
import { ConfigureProviderModal } from './ConfigureProviderModal.js';
import { EmptyProviders } from './EmptyProviders.js';
import { AddProviderView } from './AddProviderView.js';
import { ProviderModelsView } from './ProviderModelsView.js';
import { ModelDetailView } from './ModelDetailView.js';
import { MainModelCard } from './MainModelCard.js';
import { ModelPickerModal } from './ModelPickerModal.js';
import type { ProviderEntry } from '@/types/index.js';
import styles from './ModelSwitcherView.module.css';

export const ModelSwitcherView: Component = () => {
  const [selectedProvider, setSelectedProvider] = createSignal<string | null>(null);
  const [configuringProvider, setConfiguringProvider] = createSignal<ProviderEntry | null>(null);
  const [activeTab, setActiveTab] = createSignal('providers');
  const [pickerOpen, setPickerOpen] = createSignal(false);

  onMount(() => {
    // load() is idempotent (hasLoaded guard + dedup); no extra loadActive needed.
    void modelsStore.load();
  });

  createEffect(() => {
    if (modelStore.defaultProvider && !selectedProvider()) {
      setSelectedProvider(modelStore.defaultProvider);
    }
  });

  const handleConfigureProvider = (provider: ProviderEntry) => {
    setConfiguringProvider(provider);
  };

  const handleCloseModal = () => {
    setConfiguringProvider(null);
  };

  const handleSaveProvider = (updated: ProviderEntry) => {
    modelStore.upsertProvider({ name: updated.name, is_builtin: updated.is_builtin ?? false, base_url: updated.base_url, api_key: updated.api_key, api_key_env: updated.api_key_env, display_name: updated.display_name });
    void modelStore.setProviderEnabled(updated.name, updated.enabled !== false);
    setConfiguringProvider(null);
  };

  const handleDeleteProvider = (provider: ProviderEntry) => {
    void modelStore.deleteProvider(provider.name, provider.is_builtin ?? false);
  };

  const isInitialLoading = () =>
    modelsStore.loading() &&
    !modelsStore.hasLoaded() &&
    modelsStore.providers().length === 0;

  const shouldShowEmpty = () =>
    modelsStore.hasLoaded() &&
    !modelsStore.loading() &&
    modelsStore.providers().length === 0 &&
    !modelsStore.error();

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
          <MainModelCard
            provider={modelStore.defaultProvider}
            model={modelStore.defaultModel}
            onChangeClick={() => setPickerOpen(true)}
          />

          <Show when={isInitialLoading()}>
            <div
              class={styles.skeletonGrid}
              aria-busy="true"
              aria-label="Loading providers"
            >
              <For each={[0, 1, 2, 3]}>
                {() => (
                  <div class={styles.skeletonCard}>
                    <div class={styles.skeletonHeader}>
                      <div class={styles.skeletonAvatar} />
                      <div class={styles.skeletonTitleGroup}>
                        <div class={styles.skeletonLineWide} />
                        <div class={styles.skeletonLineShort} />
                      </div>
                    </div>
                    <div class={styles.skeletonLineFull} />
                    <div class={styles.skeletonLineMedium} />
                    <div class={styles.skeletonFooter}>
                      <div class={styles.skeletonPill} />
                      <div class={styles.skeletonButton} />
                    </div>
                  </div>
                )}
              </For>
            </div>
          </Show>

          <Show when={shouldShowEmpty()}>
            <EmptyProviders />
          </Show>

          <Show when={modelsStore.providers().length > 0}>
            <div class={styles.tabsRow}>
              <Tabs
                tabs={[
                  { id: 'providers', label: 'Providers' },
                  { id: 'models', label: 'Models' },
                  { id: 'multimodal', label: 'Multimodal' },
                ]}
                activeTab={activeTab()}
                onChange={setActiveTab}
              />
            </div>

            <Show when={activeTab() === 'providers'}>
              <section class={styles.providersSection}>
                <div class={styles.providerGrid}>
                  <For each={modelsStore.providers()}>
                    {(provider) => (
                      <ProviderCard
                        provider={provider}
                        modelCount={provider.models?.length ?? 0}
                        isActive={modelStore.activeProvider === provider.name}
                        onClick={() =>
                          modelStore.openProviderDetail(provider.name)
                        }
                        onConfigure={() => handleConfigureProvider(provider)}
                        onDelete={() => handleDeleteProvider(provider)}
                      />
                    )}
                  </For>
                </div>
              </section>
            </Show>

            <Show when={activeTab() === 'models'}>
              <section class={styles.usageSection}>
                <ModelUsageView />
              </section>
            </Show>

            <Show when={activeTab() === 'multimodal'}>
              <section class={styles.usageSection}>
                <MultimodalModelsView />
              </section>
            </Show>
          </Show>

          <Show when={modelStore.error || modelsStore.error()}>
            <div class={styles.error}>
              {modelStore.error ?? modelsStore.error()?.message}
            </div>
          </Show>

          <ConfigureProviderModal
            open={!!configuringProvider()}
            provider={configuringProvider()}
            onClose={handleCloseModal}
            onSave={handleSaveProvider}
          />

          <ModelPickerModal
            open={pickerOpen()}
            currentProvider={modelStore.defaultProvider}
            currentModel={modelStore.defaultModel}
            providers={modelsStore.providers()}
            onApply={async (provider, model) => {
              const ok = await modelStore.switchModel(provider, model, { scope: 'global' });
              if (ok) setPickerOpen(false);
            }}
            onClose={() => setPickerOpen(false)}
          />
        </div>
      </Match>
    </Switch>
  );
};
