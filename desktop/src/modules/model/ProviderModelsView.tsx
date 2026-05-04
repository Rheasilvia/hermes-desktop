import type { Component } from 'solid-js';
import { createSignal, Show, For } from 'solid-js';
import { modelStore } from '@/stores/models.js';
import type { ProviderEntry, ModelOption } from '@/types/index.js';
import { Button } from '@/components/Button.js';
import { Icon } from '@/components/Icon.js';
import { Toggle } from '@/components/Toggle.js';
import { ConfigureProviderModal } from './ConfigureProviderModal.js';
import styles from './ProviderModelsView.module.css';

function maskApiKey(key: string | undefined): string {
  if (!key) return 'Not configured';
  if (key.length <= 8) return '••••••••';
  return key.slice(0, 4) + '••••••••••••••';
}

function formatContext(ctx: number | undefined): string {
  if (!ctx) return '—';
  if (ctx >= 1_000_000) return `${(ctx / 1_000_000).toFixed(0)}M`;
  if (ctx >= 1_000) return `${(ctx / 1_000).toFixed(0)}K`;
  return String(ctx);
}

function formatPrice(price: number | undefined): string {
  if (price === undefined || price === null) return '—';
  return `$${price.toFixed(2)}`;
}

export const ProviderModelsView: Component = () => {
  const [showKey, setShowKey] = createSignal(false);
  const [editing, setEditing] = createSignal(false);

  const provider = (): ProviderEntry | null => modelStore.detailProviderEntry;
  const models = (): ModelOption[] => provider()?.models ?? [];

  const apiKeyDisplay = () => {
    const key = provider()?.api_key;
    if (!key) return 'Not configured';
    return showKey() ? key : maskApiKey(key);
  };

  const handleToggleModel = (modelName: string, enabled: boolean) => {
    const p = provider();
    if (!p) return;
    modelStore.setModelEnabled(p.name, modelName, enabled);
  };

  const handleSaveProvider = (updated: ProviderEntry) => {
    const p = provider();
    if (!p) return;
    modelStore.upsertProvider({ name: updated.name, is_builtin: updated.is_builtin ?? false, base_url: updated.base_url, api_key: updated.api_key, api_key_env: updated.api_key_env, display_name: updated.display_name });
    setEditing(false);
  };

  return (
    <div class={styles.wrapper}>
      <button type="button" class={styles.backLink} onClick={() => modelStore.goBack()}>
        <Icon name="chevron-left" size={14} />
        Back
      </button>
      <div class={styles.infoCard}>
        <div class={styles.infoRow}>
          <div class={styles.infoGroup}>
            <span class={styles.infoLabel}>Base URL</span>
            <span class={styles.infoValue}>
              {provider()?.base_url ?? 'Not configured'}
            </span>
          </div>
          <div class={styles.infoGroup}>
            <span class={styles.infoLabel}>API Key</span>
            <div class={styles.apiKeyGroup}>
              <span class={styles.infoValueMono}>{apiKeyDisplay()}</span>
              <Show when={provider()?.api_key}>
                <button
                  type="button"
                  class={styles.iconBtn}
                  onClick={() => setShowKey((p) => !p)}
                  aria-label={showKey() ? 'Hide API key' : 'Show API key'}
                  title={showKey() ? 'Hide API key' : 'Show API key'}
                >
                  <Icon name={showKey() ? 'eye-off' : 'eye'} size={14} />
                </button>
              </Show>
            </div>
          </div>
          <div class={styles.infoActions}>
            <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
              <Icon name="settings" size={14} />
              Edit
            </Button>
          </div>
        </div>
      </div>

      <div class={styles.tableSection}>
        <div class={styles.tableHeader}>
          <span class={`${styles.colModel} ${styles.colLabel}`}>Model</span>
          <span class={`${styles.colContext} ${styles.colLabel}`}>Context</span>
          <span class={`${styles.colPricing} ${styles.colLabel}`}>Pricing (input / output)</span>
          <span class={`${styles.colCaps} ${styles.colLabel}`}>Capabilities</span>
          <span class={`${styles.colStatus} ${styles.colLabel}`}>Enabled</span>
        </div>
        <For each={models()}>
          {(model) => {
            const modelEnabled = () => model.enabled !== false;
            return (
              <div
                class={styles.modelRow}
                onClick={() => {
                  const p = provider();
                  if (p) modelStore.openModelDetail(p.name, model.name);
                }}
              >
                <div class={styles.colModel}>
                  <span class={styles.modelName}>
                    {model.display_name ?? model.name}
                  </span>
                </div>
                <span class={styles.colContext}>{formatContext(model.context_length)}</span>
                <span class={styles.colPricing}>
                  {formatPrice(model.pricing_input)} / {formatPrice(model.pricing_output)}
                </span>
                <div class={styles.colCaps}>
                  <Show when={model.supports_vision}>
                    <span class={styles.capPill}>Vision</span>
                  </Show>
                  <Show when={model.supports_function_calling}>
                    <span class={styles.capPill}>Tools</span>
                  </Show>
                  <Show when={model.supports_streaming}>
                    <span class={styles.capPill}>Stream</span>
                  </Show>
                </div>
                <div class={styles.colStatus} onClick={(e) => e.stopPropagation()}>
                  <Toggle
                    checked={modelEnabled()}
                    onChange={(checked) => handleToggleModel(model.name, checked)}
                  />
                </div>
              </div>
            );
          }}
        </For>
      </div>

      <ConfigureProviderModal
        open={editing()}
        provider={provider()}
        onClose={() => setEditing(false)}
        onSave={handleSaveProvider}
      />
    </div>
  );
};
