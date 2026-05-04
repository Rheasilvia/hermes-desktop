import type { Component } from 'solid-js';
import { createSignal, Show, createEffect } from 'solid-js';
import type { ProviderEntry } from '@/types/index.js';
import { Modal } from '@/components/Modal.js';
import { Input } from '@/components/Input.js';
import { Button } from '@/components/Button.js';
import { Icon } from '@/components/Icon.js';
import { Toggle } from '@/components/Toggle.js';
import styles from './ConfigureProviderModal.module.css';

export interface ConfigureProviderModalProps {
  open: boolean;
  provider: ProviderEntry | null;
  onClose: () => void;
  onSave: (provider: ProviderEntry) => void;
}

export const ConfigureProviderModal: Component<ConfigureProviderModalProps> = (
  props,
) => {
  const [baseUrl, setBaseUrl] = createSignal('');
  const [apiKey, setApiKey] = createSignal('');
  const [apiKeyEnv, setApiKeyEnv] = createSignal('');
  const [enabled, setEnabled] = createSignal(true);
  const [showKey, setShowKey] = createSignal(false);
  const [urlError, setUrlError] = createSignal('');

  createEffect(() => {
    if (props.open && props.provider) {
      setBaseUrl(props.provider.base_url ?? '');
      setApiKey(props.provider.api_key ?? '');
      setApiKeyEnv(props.provider.api_key_env ?? '');
      setEnabled(props.provider.enabled !== false);
      setUrlError('');
      setShowKey(false);
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
      api_key: apiKey().trim() || undefined,
      api_key_env: apiKeyEnv().trim() || undefined,
      enabled: enabled(),
    });
    props.onClose();
  };

  const providerName = () => props.provider?.display_name ?? props.provider?.name ?? '';

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
          placeholder="https://api.example.com/v1"
          value={baseUrl()}
          error={urlError()}
          onInput={(e) => setBaseUrl((e.target as HTMLInputElement).value)}
        />

        <div class={styles.field}>
          <label class={styles.label}>API Key</label>
          <div class={styles.passwordRow}>
            <input
              class={styles.passwordInput}
              type={showKey() ? 'text' : 'password'}
              placeholder="sk-..."
              value={apiKey()}
              onInput={(e) => setApiKey(e.currentTarget.value)}
            />
            <button
              type="button"
              class={styles.eyeButton}
              onClick={() => setShowKey((prev) => !prev)}
              aria-label={showKey() ? 'Hide API key' : 'Show API key'}
              title={showKey() ? 'Hide API key' : 'Show API key'}
            >
              <Icon name={showKey() ? 'eye-off' : 'eye'} size={16} />
            </button>
          </div>
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
