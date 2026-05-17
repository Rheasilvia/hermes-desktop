import type { Component } from 'solid-js';
import { createSignal, createMemo, Show, For, onMount, onCleanup } from 'solid-js';
import { modelStore } from '@/stores/models.js';
import { Icon } from '@/ui/atoms/Icon.js';
import styles from './ModelSelector.module.css';

interface ModelSelectorProps {
  onModelChange?: (provider: string, model: string) => void;
}

export const ModelSelector: Component<ModelSelectorProps> = (props) => {
  const [isOpen, setIsOpen] = createSignal(false);
  let wrapperRef: HTMLDivElement | undefined;

  const activeLabel = createMemo(() => {
    const provider = modelStore.activeProvider;
    const model = modelStore.activeModel;
    if (!provider || !model) return 'Select model';
    const displayName = modelStore.activeModelOption?.display_name ?? model;
    return displayName.length > 24 ? `${displayName.slice(0, 24)}…` : displayName;
  });

  const providers = () => modelStore.providers;

  const toggleDropdown = () => setIsOpen(!isOpen());

  const handleModelSelect = async (providerName: string, modelName: string) => {
    setIsOpen(false);
    const success = await modelStore.switchModel(providerName, modelName);
    if (success && props.onModelChange) {
      props.onModelChange(providerName, modelName);
    }
  };

  const handleClickOutside = (e: MouseEvent) => {
    if (!wrapperRef) return;
    if (!wrapperRef.contains(e.target as Node)) {
      setIsOpen(false);
    }
  };

  onMount(() => {
    if (modelStore.providers.length === 0) {
      modelStore.loadModels();
    }
    document.addEventListener('click', handleClickOutside, true);
  });

  onCleanup(() => {
    document.removeEventListener('click', handleClickOutside, true);
  });

  return (
    <div class={styles.wrapper} ref={wrapperRef}>
      <span class={styles.label}>Model:</span>
      <button
        class={`${styles.trigger} ${isOpen() ? styles.triggerActive : ''}`}
        onClick={toggleDropdown}
        type="button"
        aria-label="Select model"
        aria-expanded={isOpen()}
      >
        <span class={styles.triggerText}>{activeLabel()}</span>
        <svg
          class={`${styles.chevron} ${isOpen() ? styles.chevronOpen : ''}`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      <Show when={isOpen()}>
        <div class={styles.dropdown}>
          <For each={providers()}>
            {(provider) => (
              <div class={styles.providerGroup}>
                <div class={styles.providerLabel}>{provider.display_name ?? provider.name}</div>
                <For each={provider.models ?? []}>
                  {(model) => {
                    const isActive = () =>
                      modelStore.activeProvider === provider.name &&
                      modelStore.activeModel === model.name;

                    return (
                      <button
                        class={`${styles.modelItem} ${isActive() ? styles.modelItemActive : ''}`}
                        onClick={() => handleModelSelect(provider.name, model.name)}
                        type="button"
                      >
                        <span>{model.display_name ?? model.name}</span>
                        <Show when={isActive()}>
                          <Icon name="check" size={14} class={styles.checkMark} />
                        </Show>
                      </button>
                    );
                  }}
                </For>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
};
