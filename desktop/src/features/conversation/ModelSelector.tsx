import type { Component } from 'solid-js';
import { createSignal, createMemo, createEffect, Show, For, onMount, onCleanup } from 'solid-js';
import { modelsStore } from '@/stores/models.js';
import { sessionStore } from '@/stores/session.js';
import { chatStore } from '@/stores/chat.js';
import { getGateway } from '@/stores/context.js';
import { Icon } from '@/ui/atoms/Icon.js';
import type { ReasoningEffort } from '@/types/index.js';
import styles from './ModelSelector.module.css';

interface ModelSelectorProps {
  sessionId: string;
  onModelChange?: (provider: string, model: string) => void;
  dimmed?: boolean;
  disabled?: boolean;
}

interface ModelRow {
  providerName: string;
  providerLabel: string;
  modelName: string;
  modelLabel: string;
}

const EFFORT_OPTIONS: Array<{ value: ReasoningEffort; label: string }> = [
  { value: 'none', label: 'Off' },
  { value: 'minimal', label: 'Min' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Med' },
  { value: 'high', label: 'High' },
  { value: 'xhigh', label: 'XHigh' },
];

function effortLabel(effort: ReasoningEffort): string {
  return EFFORT_OPTIONS.find(option => option.value === effort)?.label ?? 'Med';
}

export const ModelSelector: Component<ModelSelectorProps> = (props) => {
  const [isOpen, setIsOpen] = createSignal(false);
  const [highlightedIndex, setHighlightedIndex] = createSignal(0);
  const [runtimePending, setRuntimePending] = createSignal(false);
  const [runtimeAppliesNextTurn, setRuntimeAppliesNextTurn] = createSignal(false);
  let wrapperRef: HTMLDivElement | undefined;

  // Per-session model — isolated from the global default
  const sessionModel = createMemo(() => sessionStore.getSessionModel(props.sessionId));
  const currentEffort = createMemo(() => sessionStore.getSessionReasoningEffort(props.sessionId));
  const thinkingEnabled = createMemo(() => currentEffort() !== 'none');

  const hasModel = createMemo(() => !!sessionModel());

  const modelLabel = createMemo(() => {
    const sm = sessionModel();
    if (!sm) return '⚠ Select model';
    // Find display name from catalog
    const providerEntry = modelsStore.providers().find(p => p.name === sm.provider);
    const modelOption = providerEntry?.models?.find(m => m.name === sm.model);
    const displayName = modelOption?.display_name ?? sm.model;
    return displayName.length > 24 ? `${displayName.slice(0, 24)}…` : displayName;
  });

  const activeLabel = createMemo(() => {
    if (!hasModel()) return modelLabel();
    return `${modelLabel()} · ${effortLabel(currentEffort())}`;
  });

  const providers = () => modelsStore.providers();
  const modelRows = createMemo<ModelRow[]>(() => providers().flatMap(provider =>
    (provider.models ?? []).map(model => ({
      providerName: provider.name,
      providerLabel: provider.display_name ?? provider.name,
      modelName: model.name,
      modelLabel: model.display_name ?? model.name,
    })),
  ));

  const activeModelIndex = createMemo(() => {
    const sm = sessionModel();
    if (!sm) return 0;
    const index = modelRows().findIndex(row =>
      row.providerName === sm.provider && row.modelName === sm.model
    );
    return index >= 0 ? index : 0;
  });

  createEffect(() => {
    if (props.sessionId) {
      setRuntimePending(false);
      setRuntimeAppliesNextTurn(false);
    }
  });

  createEffect(() => {
    if (isOpen()) {
      setHighlightedIndex(activeModelIndex());
    }
  });

  createEffect(() => {
    if (!isOpen() || !wrapperRef) return;
    const el = wrapperRef.querySelector<HTMLElement>(`[data-model-index="${highlightedIndex()}"]`);
    requestAnimationFrame(() => {
      if (typeof el?.scrollIntoView === 'function') {
        el.scrollIntoView({ block: 'nearest' });
      }
    });
  });

  const toggleDropdown = () => { if (!props.disabled) setIsOpen(!isOpen()); };

  const updateEffort = async (effort: ReasoningEffort) => {
    if (props.disabled || runtimePending()) return;
    const sessionId = props.sessionId;
    setRuntimePending(true);
    try {
      const result = await sessionStore.updateRuntime(sessionId, { reasoningEffort: effort });
      if (props.sessionId === sessionId) {
        setRuntimeAppliesNextTurn(Boolean(result?.appliesNextTurn));
      }
    } finally {
      if (props.sessionId === sessionId) {
        setRuntimePending(false);
      }
    }
  };

  const cycleEffort = (direction: 1 | -1) => {
    const current = currentEffort();
    const index = EFFORT_OPTIONS.findIndex(option => option.value === current);
    const nextIndex = (index + direction + EFFORT_OPTIONS.length) % EFFORT_OPTIONS.length;
    void updateEffort(EFFORT_OPTIONS[nextIndex].value);
  };

  const toggleThinking = () => {
    void updateEffort(thinkingEnabled() ? 'none' : 'medium');
  };

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

  const handleKeyDown = (event: KeyboardEvent) => {
    if (props.disabled) return;
    if (!isOpen()) {
      if (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowDown') {
        event.preventDefault();
        setIsOpen(true);
      }
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      setIsOpen(false);
      return;
    }

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const rows = modelRows();
      if (!rows.length) return;
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      setHighlightedIndex((highlightedIndex() + delta + rows.length) % rows.length);
      return;
    }

    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault();
      cycleEffort(event.key === 'ArrowRight' ? 1 : -1);
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      const row = modelRows()[highlightedIndex()];
      if (row) {
        void handleModelSelect(row.providerName, row.modelName);
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
    // Ensure catalog is loaded (no-op if already fresh)
    void modelsStore.load();
    document.addEventListener('click', handleClickOutside, true);
  });

  onCleanup(() => {
    document.removeEventListener('click', handleClickOutside, true);
  });

  return (
    <div class={styles.wrapper} ref={wrapperRef} onKeyDown={handleKeyDown}>
      <button
        class={`${styles.trigger} ${isOpen() ? styles.triggerActive : ''} ${props.dimmed ? styles.triggerDimmed : ''}`}
        onClick={toggleDropdown}
        type="button"
        aria-label="Select model"
        aria-expanded={isOpen()}
        disabled={props.disabled}
        data-testid="model-selector-trigger"
      >
        <Icon name="cpu" size={12} class={`${styles.triggerIcon} ${props.dimmed ? styles.triggerIconDimmed : ''}`} />
        <span class={styles.triggerText}>{activeLabel()}</span>
        <Icon name="chevron-down" size={10} class={`${styles.chevronIcon} ${props.dimmed ? styles.chevronIconDimmed : ''}`} />
      </button>
      <Show when={isOpen()}>
        <div class={styles.dropdown} role="group" aria-label="Model and effort">
          <div class={styles.runtimePanel}>
            <button
              type="button"
              role="switch"
              aria-checked={thinkingEnabled()}
              class={`${styles.thinkingToggle} ${thinkingEnabled() ? styles.thinkingToggleOn : ''}`}
              onClick={toggleThinking}
              disabled={runtimePending()}
            >
              <Icon name="brain" size={13} />
              <span>Thinking</span>
            </button>
            <div class={styles.effortRail} role="group" aria-label="Reasoning effort">
              <For each={EFFORT_OPTIONS}>
                {(option) => (
                  <button
                    type="button"
                    class={`${styles.effortButton} ${currentEffort() === option.value ? styles.effortButtonActive : ''}`}
                    aria-pressed={currentEffort() === option.value}
                    onClick={() => updateEffort(option.value)}
                    disabled={runtimePending()}
                    data-testid={`model-effort-${option.value}`}
                  >
                    {option.label}
                  </button>
                )}
              </For>
            </div>
            <Show when={runtimeAppliesNextTurn()}>
              <div class={styles.nextTurnBadge}>Next turn</div>
            </Show>
          </div>
          <For each={modelRows()}>
            {(row, index) => {
              const sm = sessionModel();
              const isActive = () =>
                sm?.provider === row.providerName && sm?.model === row.modelName;
              const isHighlighted = () => highlightedIndex() === index();
              const showProvider = () =>
                index() === 0 || modelRows()[index() - 1]?.providerName !== row.providerName;

              return (
                <>
                  <Show when={showProvider()}>
                    <div class={styles.providerLabel}>{row.providerLabel}</div>
                  </Show>
                  <button
                    data-model-index={index()}
                    class={`${styles.modelItem} ${isActive() ? styles.modelItemActive : ''} ${isHighlighted() ? styles.modelItemHighlighted : ''}`}
                    onMouseEnter={() => setHighlightedIndex(index())}
                    onClick={() => handleModelSelect(row.providerName, row.modelName)}
                    type="button"
                    aria-pressed={isActive()}
                  >
                    <span>{row.modelLabel}</span>
                    <Show when={isActive()}>
                      <Icon name="check" size={14} class={styles.checkMark} />
                    </Show>
                  </button>
                </>
              );
            }}
          </For>
        </div>
      </Show>
    </div>
  );
};
