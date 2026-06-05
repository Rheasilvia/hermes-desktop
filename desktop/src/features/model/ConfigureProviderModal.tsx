import type { Component } from 'solid-js';
import { createSignal, Show, createEffect } from 'solid-js';
import type { ProviderEntry } from '@/types/index.js';
import { Modal } from '@/ui/molecules/Modal.js';
import { Input } from '@/ui/atoms/Input.js';
import { Button } from '@/ui/atoms/Button.js';
import { Icon } from '@/ui/atoms/Icon.js';
import { Toggle } from '@/ui/atoms/Toggle.js';
import { modelsStore } from '@/stores/models.js';
import styles from './ConfigureProviderModal.module.css';

export interface ConfigureProviderModalProps {
  open: boolean;
  provider: ProviderEntry | null;
  onClose: () => void;
  onSave: (provider: ProviderEntry) => void;
}

function maskApiKey(key: string | undefined): string {
  if (!key) return 'Not configured';
  if (key.length <= 8) return '********';
  return `${key.slice(0, 4)}********${key.slice(-4)}`;
}

export const ConfigureProviderModal: Component<ConfigureProviderModalProps> = (
  props,
) => {
  const [baseUrl, setBaseUrl] = createSignal('');
  const [apiKey, setApiKey] = createSignal('');
  const [apiKeyDirty, setApiKeyDirty] = createSignal(false);
  const [apiKeyEnv, setApiKeyEnv] = createSignal('');
  const [enabled, setEnabled] = createSignal(true);
  const [showKey, setShowKey] = createSignal(false);
  const [revealedKey, setRevealedKey] = createSignal<string | null>(null);
  const [revealing, setRevealing] = createSignal(false);
  const [revealError, setRevealError] = createSignal<string | null>(null);
  const [urlError, setUrlError] = createSignal('');

  createEffect(() => {
    if (props.open && props.provider) {
      // Only pre-fill base_url when it's a genuine user override (source 'desktop').
      // A provider-default must NOT be pre-filled/re-submitted — persisting it defeats
      // dynamic endpoint resolution (e.g. sk-kimi- → api.kimi.com/coding). The default
      // is shown as a placeholder instead.
      const isUserOverride = props.provider.base_url_source === 'desktop';
      setBaseUrl(isUserOverride ? (props.provider.base_url ?? '') : '');
      setApiKey('');
      setApiKeyDirty(false);
      setApiKeyEnv(props.provider.api_key_env ?? '');
      setEnabled(props.provider.enabled !== false);
      setUrlError('');
      setShowKey(false);
      setRevealedKey(null);
      setRevealError(null);
      setRevealing(false);
    }
  });

  const validate = (): boolean => {
    if (baseUrl().trim() && !baseUrl().startsWith('http')) {
      setUrlError('Must start with http:// or https://');
      return false;
    }
    setUrlError('');
    return true;
  };

  const handleSave = () => {
    if (!validate() || !props.provider) return;
    props.onSave({
      ...props.provider,
      base_url: baseUrl().trim() || undefined,
      api_key: apiKeyDirty() ? apiKey().trim() || undefined : undefined,
      api_key_env: apiKeyEnv().trim() || undefined,
      enabled: enabled(),
    });
    props.onClose();
  };

  const providerName = () => props.provider?.display_name ?? props.provider?.name ?? '';
  const currentApiKeyDisplay = () => {
    const provider = props.provider;
    const key = revealedKey() ?? provider?.api_key;
    if (key) return showKey() ? key : maskApiKey(key);
    if (provider?.api_key_set) {
      if (provider?.api_key_preview) return provider.api_key_preview;
      if (provider?.api_key_env) return `Set via ${provider.api_key_env}`;
      if (provider?.api_key_source) return `Set via ${provider.api_key_source}`;
    }
    return 'Not configured';
  };

  const currentApiKeyTitle = () => {
    const provider = props.provider;
    return (
      revealError() ??
      revealedKey() ??
      provider?.api_key ??
      provider?.api_key_preview ??
      provider?.api_key_env ??
      provider?.api_key_source ??
      undefined
    );
  };

  const canRevealCurrentKey = () => {
    const provider = props.provider;
    // Only treat as "has a key" when api_key_set is true or an actual key string exists.
    // api_key_env alone is just a hint (env var name), not proof of a configured key.
    return Boolean(provider?.api_key || provider?.api_key_set);
  };

  const toggleCurrentKeyVisibility = async () => {
    const provider = props.provider;
    if (!provider) return;
    setRevealError(null);
    if (showKey()) {
      setShowKey(false);
      return;
    }
    if (!revealedKey() && !provider.api_key && provider.api_key_set) {
      setRevealing(true);
      try {
        setRevealedKey(await modelsStore.revealProviderApiKey(provider.name));
      } catch {
        setRevealError('Unable to reveal key');
        return;
      } finally {
        setRevealing(false);
      }
    }
    setShowKey(true);
  };

  const apiKeyPlaceholder = () => {
    if (canRevealCurrentKey()) return undefined;
    return 'Not configured';
  };

  const apiKeyValue = () => {
    if (apiKeyDirty()) return apiKey();
    if (canRevealCurrentKey()) return currentApiKeyDisplay();
    return '';
  };

  const handleApiKeyFocus = () => {
    if (apiKeyDirty()) return;
    setApiKeyDirty(true);
    setShowKey(false);
    if (canRevealCurrentKey()) {
      setApiKey('');
    }
  };

  const handleApiKeyInput = (value: string) => {
    if (!apiKeyDirty()) setApiKeyDirty(true);
    setApiKey(value);
  };

  const apiKeyHelpText = () => {
    if (apiKeyDirty()) {
      if (!canRevealCurrentKey()) return apiKey().trim() ? 'Enter your API key.' : '';
      return apiKey().trim()
        ? 'This new key will replace the current one when you save.'
        : 'Leave empty to keep the current key.';
    }
    if (canRevealCurrentKey()) return 'Click into the field to replace the current key.';
    return 'Enter a key or set an environment variable below.';
  };

  return (
    <Modal
      open={props.open}
      title="Configure Provider"
      onClose={props.onClose}
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={props.onClose}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" onClick={handleSave}>
            Save Changes
          </Button>
        </>
      }
    >
      <div class={styles.form}>
        <div class={styles.field}>
          <label class={styles.label}>Provider Name</label>
          <div class={styles.readOnly}>{providerName()}</div>
        </div>

        <Input
          label="Base URL"
          placeholder={props.provider?.base_url || 'https://api.example.com/v1'}
          value={baseUrl()}
          error={urlError()}
          onInput={(e) => setBaseUrl((e.target as HTMLInputElement).value)}
        />
        <p class={styles.helpText}>
          Leave empty to use the provider's default endpoint (auto-detected from your key/region).
        </p>

        <div class={styles.field}>
          <label class={styles.label}>API Key</label>
          <div class={styles.passwordRow}>
            <input
              class={styles.passwordInput}
              type={showKey() || apiKeyDirty() || !canRevealCurrentKey() ? 'text' : 'password'}
              placeholder={apiKeyPlaceholder() ?? 'sk-...'}
              value={revealing() ? 'Loading...' : apiKeyValue()}
              title={currentApiKeyTitle()}
              onFocus={handleApiKeyFocus}
              onInput={(e) => handleApiKeyInput(e.currentTarget.value)}
            />
            <Show when={canRevealCurrentKey() && !apiKeyDirty()}>
              <button
                type="button"
                class={styles.eyeButton}
                onClick={toggleCurrentKeyVisibility}
                disabled={revealing()}
                aria-label={showKey() ? 'Hide API key' : 'Show API key'}
                title={showKey() ? 'Hide API key' : 'Show API key'}
              >
                <Icon name={showKey() ? 'eye-off' : 'eye'} size={16} />
              </button>
            </Show>
          </div>
          <p class={styles.helpText}>{apiKeyHelpText()}</p>
          <Show when={revealError()}>
            <p class={styles.errorText}>{revealError()}</p>
          </Show>
        </div>

        <Input
          label="API Key Env Variable (optional)"
          placeholder="PROVIDER_API_KEY"
          value={apiKeyEnv()}
          onInput={(e) => setApiKeyEnv((e.target as HTMLInputElement).value)}
        />

        <div class={styles.toggleRow}>
          <span class={styles.label}>Enabled</span>
          <Toggle checked={enabled()} onChange={setEnabled} />
        </div>
      </div>
    </Modal>
  );
};
