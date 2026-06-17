import type { Component } from 'solid-js';
import { createSignal, createMemo, createEffect, Show, For, onMount, onCleanup } from 'solid-js';
import { modelsStore } from '@/stores/models.js';
import { sessionStore } from '@/stores/session.js';
import { chatStore } from '@/stores/chat.js';
import { getGateway } from '@/stores/context.js';
import { Icon } from '@/ui/atoms/Icon.js';
import type { ReasoningEffort } from '@/types/index.js';
import { effortLabel, nextReasoningEffort, REASONING_EFFORT_OPTIONS } from './reasoning-effort.js';
import styles from './ModelSelector.module.css';

interface ModelSelectorProps {
  sessionId: string;
  onModelChange?: (provider: string, model: string) => void;
  dimmed?: boolean;
  disabled?: boolean;
  compact?: boolean;
}

interface ModelRow {
  providerName: string;
  providerLabel: string;
  modelName: string;
  modelLabel: string;
}

function compactEffortLabel(effort: ReasoningEffort): string {
  switch (effort) {
    case 'high':
      return 'Hi';
    case 'xhigh':
      return 'XHi';
    default:
      return effortLabel(effort);
  }
}

export const ModelSelector: Component<ModelSelectorProps> = (props) => {
  const [openPanel, setOpenPanel] = createSignal<'model' | null>(null);
  const [highlightedIndex, setHighlightedIndex] = createSignal(0);
  const [runtimePending, setRuntimePending] = createSignal(false);
  const [runtimeAppliesNextTurn, setRuntimeAppliesNextTurn] = createSignal(false);
  let wrapperRef: HTMLDivElement | undefined;
  const isModelOpen = () => openPanel() === 'model';

  // Per-session model — isolated from the global default
  const sessionModel = createMemo(() => sessionStore.getSessionModel(props.sessionId));
  const currentEffort = createMemo(() => sessionStore.getSessionReasoningEffort(props.sessionId));
  const thinkingEnabled = createMemo(() => currentEffort() !== 'none');

  const hasModel = createMemo(() => !!sessionModel());

  const fullModelLabel = createMemo(() => {
    const sm = sessionModel();
    if (!sm) return '⚠ Select model';
    // Find display name from catalog
    const providerEntry = modelsStore.providers().find(p => p.name === sm.provider);
    const modelOption = providerEntry?.models?.find(m => m.name === sm.model);
    return modelOption?.display_name ?? sm.model;
  });

  const modelLabel = createMemo(() => {
    const displayName = fullModelLabel();
    return displayName.length > 24 ? `${displayName.slice(0, 24)}…` : displayName;
  });

  const modelButtonLabel = () => props.compact ? `Select model: ${fullModelLabel()}` : 'Select model';
  const effortButtonTitle = () => {
    const suffix = runtimeAppliesNextTurn() ? ' Applies next turn.' : '';
    return `Reasoning effort: ${effortLabel(currentEffort())}. Click or use Left/Right to adjust.${suffix}`;
  };

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
    if (isModelOpen()) {
      setHighlightedIndex(activeModelIndex());
    }
  });

  createEffect(() => {
    if (!isModelOpen() || !wrapperRef) return;
    const el = wrapperRef.querySelector<HTMLElement>(`[data-model-index="${highlightedIndex()}"]`);
    requestAnimationFrame(() => {
      if (typeof el?.scrollIntoView === 'function') {
        el.scrollIntoView({ block: 'nearest' });
      }
    });
  });

  const toggleModelPanel = () => {
    if (!props.disabled) setOpenPanel(isModelOpen() ? null : 'model');
  };

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
    void updateEffort(nextReasoningEffort(currentEffort(), direction));
  };

  const toggleThinking = () => {
    void updateEffort(thinkingEnabled() ? 'none' : 'medium');
  };

  const handleModelSelect = async (providerName: string, modelName: string) => {
    setOpenPanel(null);
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

  const handleOpenPickerKeyDown = (event: KeyboardEvent) => {
    if (props.disabled || !isModelOpen()) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      setOpenPanel(null);
      return;
    }

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      event.stopPropagation();
      const rows = modelRows();
      if (!rows.length) return;
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      setHighlightedIndex((highlightedIndex() + delta + rows.length) % rows.length);
      return;
    }

    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault();
      event.stopPropagation();
      cycleEffort(event.key === 'ArrowRight' ? 1 : -1);
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      const row = modelRows()[highlightedIndex()];
      if (row) {
        void handleModelSelect(row.providerName, row.modelName);
      }
    }
  };

  const handleTriggerKeyDown = (event: KeyboardEvent) => {
    if (props.disabled || isModelOpen()) return;
    if (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowDown') {
      event.preventDefault();
      event.stopPropagation();
      setOpenPanel('model');
    }
  };

  const handleEffortKeyDown = (event: KeyboardEvent) => {
    if (props.disabled) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      event.stopPropagation();
      cycleEffort(1);
      return;
    }
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault();
      event.stopPropagation();
      cycleEffort(event.key === 'ArrowRight' ? 1 : -1);
      return;
    }
  };

  const handleClickOutside = (e: MouseEvent) => {
    if (!wrapperRef) return;
    if (!wrapperRef.contains(e.target as Node)) {
      setOpenPanel(null);
    }
  };

  onMount(() => {
    // Ensure catalog is loaded (no-op if already fresh)
    void modelsStore.load();
    document.addEventListener('click', handleClickOutside, true);
  });

  createEffect(() => {
    if (!isModelOpen()) return;
    document.addEventListener('keydown', handleOpenPickerKeyDown, true);
    onCleanup(() => {
      document.removeEventListener('keydown', handleOpenPickerKeyDown, true);
    });
  });

  onCleanup(() => {
    document.removeEventListener('click', handleClickOutside, true);
  });

  return (
    <div class={styles.wrapper} ref={wrapperRef}>
      <div
        class={styles.trigger}
        classList={{
          [styles.triggerActive]: isModelOpen(),
          [styles.triggerDimmed]: props.dimmed,
          [styles.triggerCompact]: props.compact,
        }}
      >
        <button
          class={styles.modelSegment}
          classList={{ [styles.modelSegmentCompact]: props.compact }}
          onClick={toggleModelPanel}
          onKeyDown={handleTriggerKeyDown}
          type="button"
          aria-label={modelButtonLabel()}
          aria-expanded={isModelOpen()}
          title={fullModelLabel()}
          disabled={props.disabled}
          data-testid="model-selector-trigger"
        >
          <Icon name="cpu" size={props.compact ? 14 : 12} class={`${styles.triggerIcon} ${props.dimmed ? styles.triggerIconDimmed : ''}`} />
          <Show when={!props.compact}>
            <span class={styles.triggerText}>{modelLabel()}</span>
            <Icon name="chevron-down" size={10} class={`${styles.chevronIcon} ${props.dimmed ? styles.chevronIconDimmed : ''}`} />
          </Show>
        </button>
        <button
          class={styles.effortSegment}
          classList={{ [styles.effortSegmentCompact]: props.compact }}
          onClick={() => cycleEffort(1)}
          onKeyDown={handleEffortKeyDown}
          type="button"
          aria-label={effortButtonTitle()}
          aria-keyshortcuts="ArrowLeft ArrowRight"
          title={effortButtonTitle()}
          disabled={props.disabled || !hasModel()}
          data-testid="model-effort-trigger"
        >
          <span>{props.compact ? compactEffortLabel(currentEffort()) : effortLabel(currentEffort())}</span>
          <Show when={runtimeAppliesNextTurn() && !props.compact}>
            <span class={styles.nextTurnInline}>Next</span>
          </Show>
        </button>
      </div>
      <Show when={isModelOpen()}>
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
              <For each={REASONING_EFFORT_OPTIONS}>
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
