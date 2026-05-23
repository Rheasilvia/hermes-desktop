import type { Component } from 'solid-js';
import { createSignal, createMemo, Show, For, onMount, onCleanup } from 'solid-js';
import { modelStore } from '@/stores/models.js';
import { getGateway } from '@/stores/context.js';
import { Icon } from '@/ui/atoms/Icon.js';
import styles from './ModelSelector.module.css';

interface ModelSelectorProps {
  sessionId: string;
  onModelChange?: (provider: string, model: string) => void;
  dimmed?: boolean;
  disabled?: boolean;
}

export const ModelSelector: Component<ModelSelectorProps> = (props) => {
  const [isOpen, setIsOpen] = createSignal(false);
  let wrapperRef: HTMLDivElement | undefined;

  const hasModel = createMemo(() => {
    return !!modelStore.activeProvider && !!modelStore.activeModel;
  });

  const activeLabel = createMemo(() => {
    if (!hasModel()) return '⚠ Select model';
    const displayName = modelStore.activeModelOption?.display_name ?? modelStore.activeModel!;
    return displayName.length > 24 ? `${displayName.slice(0, 24)}…` : displayName;
  });

  const providers = () => modelStore.providers;

  const toggleDropdown = () => { if (!props.disabled) setIsOpen(!isOpen()); };

  const handleModelSelect = async (providerName: string, modelName: string) => {
    setIsOpen(false);
    const success = await modelStore.switchModel(providerName, modelName);
    if (success) {
      // Update session-level provider in backend
      const gateway = getGateway();
      if (gateway) {
        await gateway.setSessionProvider(props.sessionId, providerName, modelName);
      }
      if (props.onModelChange) {
        props.onModelChange(providerName, modelName);
      }
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
      <button
        class={`${styles.trigger} ${isOpen() ? styles.triggerActive : ''} ${props.dimmed ? styles.triggerDimmed : ''}`}
        onClick={toggleDropdown}
        type="button"
        aria-label="Select model"
        aria-expanded={isOpen()}
        disabled={props.disabled}
      >
        <Icon name="cpu" size={12} class={`${styles.triggerIcon} ${props.dimmed ? styles.triggerIconDimmed : ''}`} />
        <span class={styles.triggerText}>{activeLabel()}</span>
        <Icon name="chevron-down" size={10} class={`${styles.chevronIcon} ${props.dimmed ? styles.chevronIconDimmed : ''}`} />
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
