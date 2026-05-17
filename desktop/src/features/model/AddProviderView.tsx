import type { Component } from 'solid-js';
import { createSignal, For, Show } from 'solid-js';
import { modelStore, BUILT_IN_PROVIDERS } from '@/stores/models.js';
import type { BuiltInProvider } from '@/stores/models.js';
import type { ProviderEntry } from '@/types/index.js';
import { Button } from '@/ui/atoms/Button.js';
import { Input } from '@/ui/atoms/Input.js';
import { Icon } from '@/ui/atoms/Icon.js';
import styles from './AddProviderView.module.css';

const CUSTOM_BASE_URLS: Record<string, string> = {
  OpenAI: 'https://api.openai.com/v1',
  Anthropic: 'https://api.anthropic.com',
  Google: 'https://generativelanguage.googleapis.com',
  DeepSeek: 'https://api.deepseek.com',
  Ollama: 'http://localhost:11434',
  'LM Studio': 'http://localhost:1234',
  vLLM: 'http://localhost:8000',
};

export const AddProviderView: Component = () => {
  const [search, setSearch] = createSignal('');
  const [addingProvider, setAddingProvider] = createSignal<string | null>(null);
  const [customName, setCustomName] = createSignal('');
  const [customUrl, setCustomUrl] = createSignal('');
  const [customKey, setCustomKey] = createSignal('');
  const [nameError, setNameError] = createSignal('');
  const [urlError, setUrlError] = createSignal('');

  const filterProviders = (category: 'popular' | 'local'): BuiltInProvider[] => {
    const q = search().toLowerCase();
    return BUILT_IN_PROVIDERS.filter(
      p => p.category === category && (!q || p.name.toLowerCase().includes(q)),
    );
  };

  const handleAddBuiltIn = (provider: BuiltInProvider) => {
    const baseUrl = CUSTOM_BASE_URLS[provider.name] ?? '';
    modelStore.upsertProvider({
      name: provider.name.toLowerCase().replace(/\s+/g, '-'),
      is_builtin: true,
      display_name: provider.name,
      base_url: baseUrl,
      api_key: '',
    });
    modelStore.navigateTo('hub');
  };

  const handleAddCustom = () => {
    let valid = true;
    if (!customName().trim()) {
      setNameError('Name is required');
      valid = false;
    } else {
      setNameError('');
    }
    if (customUrl().trim() && !customUrl().startsWith('http')) {
      setUrlError('Must start with http:// or https://');
      valid = false;
    } else {
      setUrlError('');
    }
    if (!valid) return;

    modelStore.upsertProvider({
      name: customName().trim().toLowerCase().replace(/\s+/g, '-'),
      is_builtin: false,
      display_name: customName().trim(),
      base_url: customUrl().trim() || undefined,
      api_key: customKey().trim() || undefined,
    });
    setCustomName('');
    setCustomUrl('');
    setCustomKey('');
    setAddingProvider(null);
  };

  const alreadyAdded = (name: string): boolean =>
    modelStore.providers.some(
      p =>
        p.display_name === name ||
        p.name === name.toLowerCase().replace(/\s+/g, '-'),
    );

  const customProviders = (): ProviderEntry[] =>
    modelStore.providers.filter(
      p =>
        !BUILT_IN_PROVIDERS.some(
          bp =>
            bp.name === p.display_name ||
            bp.name.toLowerCase().replace(/\s+/g, '-') === p.name,
        ),
    );

  return (
    <div class={styles.wrapper}>
      <button type="button" class={styles.backLink} onClick={() => modelStore.goBack()}>
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

      <div class={styles.section}>
        <h3 class={styles.sectionTitle}>Popular</h3>
        <div class={styles.cardGrid}>
          <For each={filterProviders('popular')}>
            {(provider) => {
              const added = alreadyAdded(provider.name);
              return (
                <button
                  type="button"
                  class={`${styles.card} ${added ? styles.cardAdded : ''}`}
                  onClick={() => !added && handleAddBuiltIn(provider)}
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

      <div class={styles.section}>
        <h3 class={styles.sectionTitle}>Local / Self-hosted</h3>
        <div class={styles.cardGrid}>
          <For each={filterProviders('local')}>
            {(provider) => {
              const added = alreadyAdded(provider.name);
              return (
                <button
                  type="button"
                  class={`${styles.card} ${added ? styles.cardAdded : ''}`}
                  onClick={() => !added && handleAddBuiltIn(provider)}
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

      <Show when={customProviders().length > 0}>
        <div class={styles.section}>
          <h3 class={styles.sectionTitle}>Custom</h3>
          <div class={styles.cardGrid}>
            <For each={customProviders()}>
              {(provider) => (
                <div class={`${styles.card} ${styles.cardAdded}`}>
                  <span class={styles.cardName}>{provider.display_name ?? provider.name}</span>
                  <span class={styles.cardDesc}>{provider.base_url ?? 'No base URL'}</span>
                  <span class={`${styles.badge} ${styles.badgeCustom}`}>Custom</span>
                  <span class={styles.addedLabel}>Added</span>
                </div>
              )}
            </For>
          </div>
        </div>
      </Show>

      <div class={styles.section}>
        <h3 class={styles.sectionTitle}>Custom Endpoint</h3>
        <Show
          when={addingProvider() !== null}
          fallback={
            <button
              type="button"
              class={styles.customCard}
              onClick={() => setAddingProvider('custom')}
            >
              <div class={styles.customInfo}>
                <span class={styles.cardName}>Custom Endpoint</span>
                <span class={styles.cardDesc}>Add your own OpenAI-compatible API endpoint</span>
              </div>
              <Button variant="primary" size="sm">Configure</Button>
            </button>
          }
        >
          <div class={styles.customForm}>
            <Input
              label="Name"
              placeholder="my-provider"
              value={customName()}
              error={nameError()}
              onInput={e => setCustomName(e.currentTarget.value)}
            />
            <Input
              label="Base URL"
              placeholder="https://api.example.com/v1"
              value={customUrl()}
              error={urlError()}
              onInput={e => setCustomUrl(e.currentTarget.value)}
            />
            <Input
              label="API Key"
              placeholder="sk-..."
              value={customKey()}
              onInput={e => setCustomKey(e.currentTarget.value)}
            />
            <div class={styles.customFormActions}>
              <Button variant="ghost" size="sm" onClick={() => setAddingProvider(null)}>Cancel</Button>
              <Button variant="primary" size="sm" onClick={handleAddCustom}>Add</Button>
            </div>
          </div>
        </Show>
      </div>
    </div>
  );
};
