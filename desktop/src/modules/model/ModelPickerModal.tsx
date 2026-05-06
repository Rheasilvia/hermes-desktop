import type { Component } from 'solid-js';
import { createSignal, createMemo, For, Show } from 'solid-js';
import type { ProviderEntry, ModelOption } from '@/types/index.js';
import styles from './ModelPickerModal.module.css';

export interface ModelPickerModalProps {
  open: boolean;
  currentProvider: string | null;
  currentModel: string | null;
  providers: ProviderEntry[];
  onApply: (provider: string, model: string) => void;
  onClose: () => void;
}

export const ModelPickerModal: Component<ModelPickerModalProps> = (props) => {
  const [searchQuery, setSearchQuery] = createSignal('');
  const [pickedProvider, setPickedProvider] = createSignal<string | null>(null);
  const [pickedModel, setPickedModel] = createSignal<string | null>(null);

  const filteredProviders = createMemo<ProviderEntry[]>(() => {
    const query = searchQuery().toLowerCase();
    if (!query) return props.providers;
    return props.providers.filter((p) => {
      const nameMatch = p.name.toLowerCase().includes(query);
      const modelMatch = (p.models ?? []).some(
        (m: ModelOption) =>
          m.name.toLowerCase().includes(query) ||
          (m.display_name ?? '').toLowerCase().includes(query),
      );
      return nameMatch || modelMatch;
    });
  });

  const effectiveProvider = createMemo<string | null>(
    () => pickedProvider() ?? props.currentProvider ?? props.providers[0]?.name ?? null
  );

  const selectedEntry = createMemo<ProviderEntry | null>(() => {
    const name = effectiveProvider();
    return filteredProviders().find((p) => p.name === name) ?? null;
  });

  const models = createMemo<ModelOption[]>(() => {
    return selectedEntry()?.models ?? [];
  });

  const effectiveModel = createMemo<string | null>(
    () =>
      pickedModel() ??
      (selectedEntry()?.name === props.currentProvider ? props.currentModel : null)
  );

  const isDirty = createMemo<boolean>(
    () => {
      const ep = effectiveProvider();
      const em = effectiveModel();
      return (
        ep !== null &&
        em !== null &&
        (ep !== props.currentProvider || em !== props.currentModel)
      );
    }
  );

  const handleOverlayClick = (e: MouseEvent) => {
    if (e.target === e.currentTarget) {
      props.onClose();
    }
  };

  const handleSwitch = () => {
    const ep = effectiveProvider();
    const em = effectiveModel();
    if (ep && em) {
      props.onApply(ep, em);
    }
  };

  const handlePickProvider = (name: string) => {
    setPickedProvider(name);
    setPickedModel(null);
  };

  return (
    <Show when={props.open}>
      <div
        class={styles.overlay}
        data-testid="model-picker-overlay"
        onClick={handleOverlayClick}
        role="dialog"
        aria-modal="true"
        aria-label="Select model"
      >
        <div class={styles.modal} data-testid="model-picker-modal">
          {/* Header */}
          <div class={styles.header}>
            <div class={styles.headerLeft}>
              <span class={styles.title}>Set Main Model</span>
              <Show when={props.currentProvider && props.currentModel}>
                <span class={styles.subtitle}>
                  current: {props.currentModel} · {props.currentProvider}
                </span>
              </Show>
            </div>
            <button
              type="button"
              class={styles.closeBtn}
              onClick={props.onClose}
              aria-label="Close model picker"
            >
              ✕
            </button>
          </div>

          {/* Search */}
          <div class={styles.search}>
            <span class={styles.searchIcon} aria-hidden="true">⌕</span>
            <input
              class={styles.searchInput}
              type="text"
              placeholder="Search providers or models…"
              value={searchQuery()}
              onInput={(e) => setSearchQuery(e.currentTarget.value)}
              data-testid="model-picker-search"
              aria-label="Search providers and models"
            />
          </div>

          {/* Two-column body */}
          <div class={styles.body}>
            {/* Provider column */}
            <div class={styles.provCol} role="listbox" aria-label="Providers">
              <For each={filteredProviders()}>
                {(provider) => (
                  <button
                    type="button"
                    class={`${styles.provRow}${effectiveProvider() === provider.name ? ` ${styles.provRowActive}` : ''}`}
                    onClick={() => handlePickProvider(provider.name)}
                    data-testid={`provider-row-${provider.name}`}
                    aria-selected={effectiveProvider() === provider.name}
                    role="option"
                  >
                    {provider.display_name ?? provider.name}
                  </button>
                )}
              </For>
            </div>

            {/* Model column */}
            <div class={styles.modelCol} role="listbox" aria-label="Models">
              <For each={models()}>
                {(model) => {
                  const isSelected = () => effectiveModel() === model.name;
                  const isCurrent = () =>
                    props.currentProvider === effectiveProvider() &&
                    props.currentModel === model.name;
                  return (
                    <button
                      type="button"
                      class={`${styles.modelRow}${isSelected() ? ` ${styles.modelRowSelected}` : ''}`}
                      onClick={() => setPickedModel(model.name)}
                      data-testid={`model-row-${model.name}`}
                      aria-selected={isSelected()}
                      role="option"
                    >
                      <Show
                        when={isSelected()}
                        fallback={<span class={styles.checkPlaceholder} aria-hidden="true" />}
                      >
                        <span class={styles.checkIcon} aria-hidden="true">✓</span>
                      </Show>
                      <span>{model.display_name ?? model.name}</span>
                      <Show when={isCurrent()}>
                        <span class={styles.currentBadge}>current</span>
                      </Show>
                    </button>
                  );
                }}
              </For>
            </div>
          </div>

          {/* Footer */}
          <div class={styles.footer}>
            <span class={styles.footerNote}>Persists to ~/.hermes/config.yaml</span>
            <button
              type="button"
              class={styles.cancelBtn}
              onClick={props.onClose}
              data-testid="model-picker-cancel-btn"
            >
              Cancel
            </button>
            <button
              type="button"
              class={styles.switchBtn}
              onClick={handleSwitch}
              disabled={!isDirty()}
              data-testid="model-picker-switch-btn"
            >
              Switch
            </button>
          </div>
        </div>
      </div>
    </Show>
  );
};
