import type { Component } from 'solid-js';
import { createSignal, For, Show, onMount } from 'solid-js';
import { modelStore, modelsStore, BUILT_IN_PROVIDERS, type CatalogProvider } from '@/stores/models.js';
import { Icon } from '@/ui/atoms/Icon.js';
import styles from './AddProviderView.module.css';

export const AddProviderView: Component = () => {
  const [search, setSearch] = createSignal('');

  onMount(() => {
    void modelsStore.loadCatalog();
  });

  /** Whether the API catalog is available (loaded or cached). */
  const hasCatalog = () => modelsStore.catalogHasLoaded() && modelsStore.catalogProviders().length > 0;

  /** Providers with an explicit overlay entry (user clicked "Add"). */
  const configuredIds = () =>
    new Set(modelsStore.catalogProviders().filter(p => p.has_overlay).map(p => p.id));

  /** Filtered catalog providers based on search query. */
  const filteredCatalog = (): CatalogProvider[] => {
    const q = search().toLowerCase();
    const list = modelsStore.catalogProviders();
    if (!q) return list;
    return list.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.id.toLowerCase().includes(q) ||
        (p.display_name?.toLowerCase().includes(q) ?? false),
    );
  };

  /** Fallback hardcoded providers when the catalog API is unavailable. */
  const fallbackPopular = () => {
    const q = search().toLowerCase();
    return BUILT_IN_PROVIDERS.filter(
      p => p.category === 'popular' && (!q || p.name.toLowerCase().includes(q)),
    );
  };

  const fallbackLocal = () => {
    const q = search().toLowerCase();
    return BUILT_IN_PROVIDERS.filter(
      p => p.category === 'local' && (!q || p.name.toLowerCase().includes(q)),
    );
  };

  /** Determine the badge style for a provider based on auth_type. */
  const badgeClass = (provider: CatalogProvider): string => {
    const authType = provider.auth_type ?? provider.auth;
    if (authType === 'oauth') return styles.badgeOAuth;
    if (authType === 'api_key') return styles.badgeBuiltin;
    return styles.badgeLocal;
  };

  /** Human-readable label for auth type. */
  const badgeLabel = (provider: CatalogProvider): string => {
    const authType = provider.auth_type ?? provider.auth;
    if (authType === 'oauth') return 'OAuth';
    if (authType === 'api_key') return 'API Key';
    return 'No Auth';
  };

  const handleAddCatalogProvider = (provider: CatalogProvider) => {
    modelStore.setDraftProvider(provider);
    modelStore.openProviderDetail(provider.id);
  };

  const handleAddBuiltIn = (name: string) => {
    const slug = name.toLowerCase().replace(/\s+/g, '-');
    modelStore.setDraftProvider({ id: slug, name, modelCount: 0, display_name: name });
    modelStore.openProviderDetail(slug);
  };


  return (
    <div class={styles.wrapper}>
      <button type="button" class={styles.backLink} onClick={() => modelStore.navigateTo('hub')}>
        <Icon name="chevron-left" size={14} />
        Back
      </button>
      <div class={styles.searchBar}>
        <Icon name="search" size={14} />
        <input
          class={styles.searchInput}
          placeholder="Search providers..."
          value={search()}
          onInput={e => setSearch(e.currentTarget.value)}
        />
      </div>

      {/* Dynamic catalog from the backend API */}
      <Show when={hasCatalog()} fallback={
        /* Fallback: hardcoded built-in providers */
        <>
          <Show when={modelsStore.catalogLoading()}>
            <div class={styles.loadingHint}>
              <Icon name="loader" size={14} />
              <span>Loading full provider catalog...</span>
            </div>
          </Show>

          <Show when={fallbackPopular().length > 0}>
            <div class={styles.section}>
              <h3 class={styles.sectionTitle}>Popular</h3>
              <div class={styles.cardGrid}>
                <For each={fallbackPopular()}>
                  {(provider) => {
                    const added = configuredIds().has(provider.name.toLowerCase().replace(/\s+/g, '-'));
                    return (
                      <button
                        type="button"
                        class={`${styles.card} ${added ? styles.cardAdded : ''}`}
                        onClick={() => !added && handleAddBuiltIn(provider.name)}
                        disabled={added}
                      >
                        <span class={styles.cardName}>{provider.name}</span>
                        <span class={styles.cardDesc}>{provider.description}</span>
                        <span class={`${styles.badge} ${styles.badgeBuiltin}`}>Built-in</span>
                        <Show when={added}>
                          <span class={styles.addedLabel}>Added</span>
                        </Show>
                      </button>
                    );
                  }}
                </For>
              </div>
            </div>
          </Show>

          <Show when={fallbackLocal().length > 0}>
            <div class={styles.section}>
              <h3 class={styles.sectionTitle}>Local / Self-hosted</h3>
              <div class={styles.cardGrid}>
                <For each={fallbackLocal()}>
                  {(provider) => {
                    const added = configuredIds().has(provider.name.toLowerCase().replace(/\s+/g, '-'));
                    return (
                      <button
                        type="button"
                        class={`${styles.card} ${added ? styles.cardAdded : ''}`}
                        onClick={() => !added && handleAddBuiltIn(provider.name)}
                        disabled={added}
                      >
                        <span class={styles.cardName}>{provider.name}</span>
                        <span class={styles.cardDesc}>{provider.description}</span>
                        <span class={`${styles.badge} ${styles.badgeLocal}`}>Local</span>
                        <Show when={added}>
                          <span class={styles.addedLabel}>Added</span>
                        </Show>
                      </button>
                    );
                  }}
                </For>
              </div>
            </div>
          </Show>
        </>
      }>
        {/* Full catalog list */}
        <div class={styles.section}>
          <h3 class={styles.sectionTitle}>
            All Providers
            <span class={styles.providerCount}>{modelsStore.catalogProviders().length}</span>
          </h3>
          <div class={styles.cardGrid}>
            <For each={filteredCatalog()}>
              {(provider) => {
                const added = configuredIds().has(provider.id);
                return (
                  <button
                    type="button"
                    class={`${styles.card} ${added ? styles.cardAdded : ''}`}
                    onClick={() => !added && handleAddCatalogProvider(provider)}
                    disabled={added}
                  >
                    <span class={styles.cardName}>{provider.display_name ?? provider.name}</span>
                    <span class={styles.cardDesc}>
                      {provider.modelCount > 0 ? `${provider.modelCount} model${provider.modelCount !== 1 ? 's' : ''}` : 'No curated models'}
                    </span>
                    <span class={styles.cardMeta}>
                      <span class={`${styles.badge} ${badgeClass(provider)}`}>{badgeLabel(provider)}</span>
                      <Show when={provider.is_current}>
                        <span class={styles.currentLabel}>Current</span>
                      </Show>
                    </span>
                    <Show when={added}>
                      <span class={styles.addedLabel}>Added</span>
                    </Show>
                  </button>
                );
              }}
            </For>
          </div>
        </div>
      </Show>
    </div>
  );
};
