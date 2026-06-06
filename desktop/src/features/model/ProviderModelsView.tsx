import type { Component } from 'solid-js';
import { createSignal, Show, For } from 'solid-js';
import { modelStore, modelsStore } from '@/stores/models.js';
import type { ProviderEntry, ModelOption } from '@/types/index.js';
import { api } from '@/services/api/router';
import type { OAuthProvider } from '@/services/api/types';
import { Button } from '@/ui/atoms/Button.js';
import { Icon } from '@/ui/atoms/Icon.js';
import { Toggle } from '@/ui/atoms/Toggle.js';
import { ConfigureProviderModal } from './ConfigureProviderModal.js';
import { OAuthConnectModal } from './OAuthConnectModal.js';
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

  // OAuth state
  const [oauthOpen, setOAuthOpen] = createSignal(false);
  const [oauthProvider, setOAuthProvider] = createSignal<OAuthProvider | null>(null);
  const [oauthLoading, setOAuthLoading] = createSignal(false);

  /** Determine whether this provider uses OAuth. */
  const isOAuth = (): boolean => {
    const draft = modelStore.draftProvider;
    if (draft && draft.id === modelStore.detailProviderName) {
      return (draft.auth_type ?? draft.auth) === 'oauth';
    }
    // For already-configured providers, check the full catalog
    const catalog = modelsStore.catalogProviders();
    const found = catalog.find((p) => p.id === modelStore.detailProviderName);
    return (found?.auth_type ?? found?.auth) === 'oauth';
  };

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

  /** Open the OAuth connect flow for this provider. */
  const handleOAuthConnect = async () => {
    setOAuthLoading(true);
    try {
      const providers = await api.oauth().listProviders();
      const match = providers.find(
        (p) => p.id === modelStore.detailProviderName,
      );
      setOAuthProvider(match ?? null);
      setOAuthOpen(true);
    } catch {
      // Even on error, open the modal so user can try
      setOAuthProvider(null);
      setOAuthOpen(true);
    } finally {
      setOAuthLoading(false);
    }
  };

  /** Called after successful OAuth connection to refresh state. */
  const handleOAuthConnected = async () => {
    // Write a minimal overlay entry so the provider shows as "Added" in
    // the add-provider catalog (configuredIds checks has_overlay).
    const providerId = modelStore.detailProviderName;
    if (providerId) {
      try {
        await api.overlays().patch('model', providerId, { visible: true });
      } catch { void 0; }
      // Clear stale localStorage caches so both the add-provider list
      // and the Model Page hub pick up the new OAuth provider immediately.
      try {
        localStorage.removeItem('hermes.desktop.model.catalog.v1');
        localStorage.removeItem('hermes.desktop.model.catalog.v2');
        localStorage.removeItem('hermes.desktop.model.providers.v1');
        localStorage.removeItem('hermes.desktop.model.providers.v2');
      } catch { void 0; }
    }
    // Refresh configured providers + full catalog.
    // Must invalidate first — load() skips when hasLoaded && !isStale.
    modelsStore.invalidate();
    await modelsStore.load();
    await modelsStore.loadCatalog();
    // Refresh OAuth status for the modal badge
    try {
      const providers = await api.oauth().listProviders();
      const match = providers.find((p) => p.id === providerId);
      setOAuthProvider(match ?? null);
    } catch { void 0; }
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
      <Show
        when={isOAuth()}
        fallback={
          /* ── API Key provider ── */
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
        }
      >
        {/* ── OAuth provider ── */}
        <div class={styles.infoCard}>
          <div class={styles.oauthInfoRow}>
            <div class={styles.infoGroup}>
              <span class={styles.infoLabel}>Authentication</span>
              <div class={styles.oauthBadgeRow}>
                <span class={styles.oauthPill}>OAuth</span>
                <Show when={oauthProvider()?.logged_in}>
                  <span class={styles.oauthConnectedPill}>Connected</span>
                </Show>
              </div>
            </div>
            <Show when={oauthProvider()?.logged_in && oauthProvider()?.source_label}>
              <div class={styles.infoGroup}>
                <span class={styles.infoLabel}>Source</span>
                <span class={styles.infoValue}>
                  {oauthProvider()?.source_label}
                </span>
              </div>
            </Show>
            <div class={styles.infoActions}>
              <Button
                variant="primary"
                size="sm"
                onClick={handleOAuthConnect}
                disabled={oauthLoading()}
              >
                {oauthLoading() ? (
                  <Icon name="loader" size={14} />
                ) : oauthProvider()?.logged_in ? (
                  <Icon name="settings" size={14} />
                ) : (
                  <Icon name="external-link" size={14} />
                )}
                {oauthLoading()
                  ? 'Loading...'
                  : oauthProvider()?.logged_in
                    ? 'Manage'
                    : `Connect`}
              </Button>
            </div>
          </div>
        </div>
      </Show>

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

      <OAuthConnectModal
        open={oauthOpen()}
        provider={oauthProvider()}
        onClose={() => setOAuthOpen(false)}
        onConnected={handleOAuthConnected}
      />
    </div>
  );
};
