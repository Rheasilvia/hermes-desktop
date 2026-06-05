import type { Component } from 'solid-js';
import { createSignal, createMemo, createEffect, Show, For, onMount, onCleanup } from 'solid-js';
import { modelsStore } from '@/stores/models.js';
import { sessionStore } from '@/stores/session.js';
import { chatStore } from '@/stores/chat.js';
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
  let activeItemRef: HTMLButtonElement | undefined;

  // When the dropdown opens, jump straight to the currently-selected model.
  createEffect(() => {
    if (isOpen() && activeItemRef) {
      const el = activeItemRef;
      requestAnimationFrame(() => el.scrollIntoView({ block: 'nearest' }));
    }
  });

  // Per-session model — isolated from the global default
  const sessionModel = createMemo(() => sessionStore.getSessionModel(props.sessionId));

  const hasModel = createMemo(() => !!sessionModel());

  const activeLabel = createMemo(() => {
    const sm = sessionModel();
    if (!sm) return '⚠ Select model';
    // Find display name from catalog
    const providerEntry = modelsStore.providers().find(p => p.name === sm.provider);
    const modelOption = providerEntry?.models?.find(m => m.name === sm.model);
    const displayName = modelOption?.display_name ?? sm.model;
    return displayName.length > 24 ? `${displayName.slice(0, 24)}…` : displayName;
  });

  const providers = () => modelsStore.providers();

  const toggleDropdown = () => { if (!props.disabled) setIsOpen(!isOpen()); };

  const handleModelSelect = async (providerName: string, modelName: string) => {
    setIsOpen(false);
    // Block switching while agent is responding
    if (chatStore.isStreaming(props.sessionId)) {
      return;
    }
    // Optimistic update for the session
    const prevModel = sessionStore.getSessionModel(props.sessionId);
    sessionStore.setSessionModel(props.sessionId, providerName, modelName);

    try {
      const gateway = getGateway();
      if (gateway) {
        await gateway.setSessionProvider(props.sessionId, providerName, modelName);
      }
      if (props.onModelChange) {
        props.onModelChange(providerName, modelName);
      }
    } catch (e) {
      // Rollback on failure
      if (prevModel) {
        sessionStore.setSessionModel(props.sessionId, prevModel.provider, prevModel.model);
      }
      console.error('[ModelSelector] failed to update session model:', e);
    }
  };

  const handleClickOutside = (e: MouseEvent) => {
    if (!wrapperRef) return;
    if (!wrapperRef.contains(e.target as Node)) {
      setIsOpen(false);
    }
  };

  onMount(() => {
    // Ensure catalog is loaded (no-op if already fresh)
    void modelsStore.load();
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
                    const sm = sessionModel();
                    const isActive = () =>
                      sm?.provider === provider.name && sm?.model === model.name;

                    return (
                      <button
                        ref={(el) => { if (isActive()) activeItemRef = el; }}
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
