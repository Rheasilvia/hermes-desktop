import type { Component } from 'solid-js';
import { createSignal, Show, For } from 'solid-js';
import { modelStore, modelsStore } from '@/stores/models.js';
import type { ProviderEntry, ModelOption } from '@/types/index.js';
import { Button } from '@/ui/atoms/Button.js';
import { Icon } from '@/ui/atoms/Icon.js';
import { Toggle } from '@/ui/atoms/Toggle.js';
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
  const [revealedKey, setRevealedKey] = createSignal<string | null>(null);
  const [revealing, setRevealing] = createSignal(false);
  const [revealError, setRevealError] = createSignal<string | null>(null);
  const [editing, setEditing] = createSignal(false);

  const provider = (): ProviderEntry | null => {
    const name = modelStore.detailProviderName;
    if (!name) return null;
    const configured = modelsStore.providers().find((p) => p.name === name);
    if (configured) return configured;
    // Not yet saved — construct a temporary entry from the draft provider
    // so the user can see defaults before explicitly saving.
    const draft = modelStore.draftProvider;
    if (draft && draft.id === name) {
      return {
        name: draft.id,
        display_name: draft.display_name ?? draft.name,
        is_builtin: true,
        enabled: true,
        base_url: draft.base_url,
        api_key_env: draft.api_key_env,
        models: [],
        api_key: undefined,
        api_key_set: false,
        api_key_preview: undefined,
        api_key_source: undefined,
        base_url_source: undefined,
      } satisfies ProviderEntry;
    }
    return null;
  };
  const models = (): ModelOption[] => provider()?.models ?? [];

  const apiKeyDisplay = () => {
    const p = provider();
    const key = revealedKey() ?? p?.api_key;
    if (key) return showKey() ? key : maskApiKey(key);
    if (p?.api_key_set) {
      if (p?.api_key_preview) return p.api_key_preview;
      if (p?.api_key_env) return `Set via ${p.api_key_env}`;
      if (p?.api_key_source) return `Set via ${p.api_key_source}`;
    }
    return 'Not configured';
  };

  const apiKeyTitle = () => {
    const p = provider();
    return (
      revealError() ??
      revealedKey() ??
      p?.api_key ??
      p?.api_key_preview ??
      p?.api_key_env ??
      p?.api_key_source ??
      undefined
    );
  };

  const canRevealKey = () => {
    const p = provider();
    return Boolean(p?.api_key || p?.api_key_set);
  };

  const toggleKeyVisibility = async () => {
    const p = provider();
    if (!p) return;
    setRevealError(null);
    if (showKey()) {
      setShowKey(false);
      return;
    }
    if (!revealedKey() && !p.api_key) {
      setRevealing(true);
      try {
        setRevealedKey(await modelsStore.revealProviderApiKey(p.name));
      } catch {
        setRevealError('Unable to reveal key');
        return;
      } finally {
        setRevealing(false);
      }
    }
    setShowKey(true);
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
    void modelStore.setProviderEnabled(updated.name, updated.enabled !== false);
    modelStore.setDraftProvider(null);
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
          <div class={`${styles.infoGroup} ${styles.apiKeyInfoGroup}`}>
            <span class={styles.infoLabel}>API Key</span>
            <div class={styles.apiKeyGroup}>
              <span class={styles.infoValueMono} title={apiKeyTitle()}>
                {revealing() ? 'Loading...' : apiKeyDisplay()}
              </span>
              <Show when={canRevealKey()}>
                <button
                  type="button"
                  class={styles.iconBtn}
                  onClick={toggleKeyVisibility}
                  disabled={revealing()}
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
