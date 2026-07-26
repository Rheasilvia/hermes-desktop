import type { Component } from 'solid-js';
import { createSignal, createEffect, Show } from 'solid-js';
import { modelStore, modelsStore } from '@/stores/models.js';
import type { ProviderEntry, ModelOption } from '@/types/index.js';
import { Button } from '@/ui/atoms/Button.js';
import { Toggle } from '@/ui/atoms/Toggle.js';
import { Icon } from '@/ui/atoms/Icon.js';
import { api } from '@/services/api/router';
import styles from './ModelDetailView.module.css';

export const ModelDetailView: Component = () => {
  const provider = (): ProviderEntry | null => modelStore.detailProviderEntry;
  const model = (): ModelOption | null => modelStore.detailModelOption;

  const [temperature, setTemperature] = createSignal(0.7);
  const [maxTokens, setMaxTokens] = createSignal(4096);
  const [visionEnabled, setVisionEnabled] = createSignal(true);
  const [toolsEnabled, setToolsEnabled] = createSignal(true);
  const [streamEnabled, setStreamEnabled] = createSignal(true);

  createEffect(() => {
    const m = model();
    if (m) {
      setTemperature(m.default_temperature ?? 0.7);
      setMaxTokens(m.default_max_tokens ?? 4096);
      setVisionEnabled(m.supports_vision !== false);
      setToolsEnabled(m.supports_function_calling !== false);
      setStreamEnabled(m.supports_streaming !== false);
    }
  });

  const isActive = () => {
    const p = provider();
    const m = model();
    return p && m && modelStore.defaultProvider === p.name && modelStore.defaultModel === m.name;
  };

  const [saving, setSaving] = createSignal(false);
  const [saveError, setSaveError] = createSignal<string | null>(null);

  const handleSave = async () => {
    const p = provider();
    const m = model();
    if (!p || !m) { modelStore.goBack(); return; }
    setSaving(true);
    setSaveError(null);
    try {
      const providerId = modelsStore.resolveId(p.name);
      await api.model().setModelParams(providerId, m.name, {
        default_temperature: temperature(),
        default_max_tokens: maxTokens(),
        supports_vision: visionEnabled(),
        supports_function_calling: toolsEnabled(),
        supports_streaming: streamEnabled(),
      });
      modelsStore.invalidate();
      await modelsStore.load();
      modelStore.goBack();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Failed to save');
      setSaving(false);
    }
  };

  const formatPrice = (price: number | undefined): string => {
    if (price === undefined || price === null) return '—';
    return `$${price.toFixed(2)}`;
  };

  const handleSliderInput = (e: Event & { currentTarget: HTMLInputElement }) => {
    setTemperature(parseFloat(e.currentTarget.value));
  };

  return (
    <div class={styles.wrapper}>
      <div class={styles.body}>
        <button type="button" class={styles.backLink} onClick={() => modelStore.goBack()}>
          <Icon name="chevron-left" size={14} />
          Back
        </button>
        <div class={styles.modelCard}>
          <div class={styles.modelInfo}>
            <span class={styles.modelName}>
              {model()?.display_name ?? model()?.name ?? ''}
            </span>
            <span class={styles.modelMeta}>
              {provider()?.display_name ?? provider()?.name} ·{' '}
              {model()?.display_name ?? model()?.name}
            </span>
          </div>
          <Show when={isActive()}>
            <div class={styles.activeBadge}>
              <span class={styles.activeDot} />
              Active
            </div>
          </Show>
        </div>

        <div class={styles.columns}>
          <div class={styles.column}>
            <h3 class={styles.sectionTitle}>Parameters</h3>

            <div class={styles.paramGroup}>
              <span class={styles.paramLabel}>Default Temperature</span>
              <div class={styles.sliderRow}>
                <input
                  type="range"
                  min="0"
                  max="2"
                  step="0.1"
                  value={temperature()}
                  onInput={handleSliderInput}
                  class={styles.slider}
                />
                <span class={styles.paramValue}>{temperature().toFixed(1)}</span>
              </div>
              <span class={styles.paramHelp}>
                Controls randomness: 0 = deterministic, 2 = maximum creativity
              </span>
            </div>

            <div class={styles.paramGroup}>
              <span class={styles.paramLabel}>Default Max Tokens</span>
              <input
                class={styles.numberInput}
                type="number"
                min={1}
                max={200000}
                value={maxTokens()}
                onInput={e => setMaxTokens(parseInt(e.currentTarget.value) || 0)}
              />
              <span class={styles.paramHelp}>
                Maximum number of tokens to generate in a response
              </span>
            </div>

            <div class={styles.paramGroup}>
              <span class={styles.paramLabel}>Context Length</span>
              <div class={styles.readOnlyField}>
                {model()?.context_length?.toLocaleString() ?? '—'}
              </div>
              <span class={styles.paramHelp}>
                Maximum context window size in tokens
              </span>
            </div>
          </div>

          <div class={styles.column}>
            <h3 class={styles.sectionTitle}>Capabilities</h3>

            <div class={styles.capRow}>
              <div class={styles.capInfo}>
                <span class={styles.capName}>Vision</span>
                <span class={styles.capDesc}>Supports image input and analysis</span>
              </div>
              <Toggle checked={visionEnabled()} onChange={setVisionEnabled} />
            </div>

            <div class={styles.capRow}>
              <div class={styles.capInfo}>
                <span class={styles.capName}>Function Calling</span>
                <span class={styles.capDesc}>Supports tool use and structured output</span>
              </div>
              <Toggle checked={toolsEnabled()} onChange={setToolsEnabled} />
            </div>

            <div class={styles.capRow}>
              <div class={styles.capInfo}>
                <span class={styles.capName}>Streaming</span>
                <span class={styles.capDesc}>Supports streaming responses</span>
              </div>
              <Toggle checked={streamEnabled()} onChange={setStreamEnabled} />
            </div>

            <div class={styles.pricing}>
              <h3 class={styles.sectionTitle}>Pricing</h3>
              <div class={styles.pricingRow}>
                <div class={styles.priceItem}>
                  <span class={styles.priceLabel}>Input</span>
                  <span class={styles.priceValue}>
                    {formatPrice(model()?.pricing_input)} / 1M tokens
                  </span>
                </div>
                <div class={styles.priceItem}>
                  <span class={styles.priceLabel}>Output</span>
                  <span class={styles.priceValue}>
                    {formatPrice(model()?.pricing_output)} / 1M tokens
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <Show when={saveError()}>
          <div class={styles.saveError}>{saveError()}</div>
        </Show>
        <div class={styles.actions}>
          <Button variant="secondary" size="sm" onClick={() => modelStore.goBack()} disabled={saving()}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" onClick={handleSave} disabled={saving()}>
            {saving() ? 'Saving…' : 'Save Changes'}
          </Button>
        </div>
      </div>
    </div>
  );
};
