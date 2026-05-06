import type { Component } from 'solid-js';
import { createSignal, Show } from 'solid-js';
import type { ProviderEntry } from '@/types/index.js';
import { Badge } from '@/components/Badge.js';
import { Icon } from '@/components/Icon.js';
import styles from './ProviderCard.module.css';

export interface ProviderCardProps {
  provider: ProviderEntry;
  modelCount: number;
  isActive: boolean;
  onClick: () => void;
  onConfigure?: () => void;
}

function maskApiKey(key: string | undefined): string {
  if (!key) return 'Not configured';
  if (key.length <= 8) return '••••••••';
  return key.slice(0, 4) + '••••••••••••••';
}

export const ProviderCard: Component<ProviderCardProps> = (props) => {
  const [showKey, setShowKey] = createSignal(false);
  const status = (): 'active' | 'inactive' =>
    props.provider.enabled !== false ? 'active' : 'inactive';

  const apiKeyDisplay = () => {
    const key = props.provider.api_key;
    if (key) return showKey() ? key : maskApiKey(key);
    if (props.provider.api_key_env) return `env:${props.provider.api_key_env}`;
    return 'Not configured';
  };

  const toggleKeyVisibility = (e: Event) => {
    e.stopPropagation();
    setShowKey((prev) => !prev);
  };

  return (
    <button
      class={`${styles.card} ${props.isActive ? styles.active : ''}`}
      type="button"
      onClick={props.onClick}
      aria-pressed={props.isActive}
    >
      <div class={styles.header}>
        <span class={styles.name}>
          {props.provider.display_name ?? props.provider.name}
        </span>
        <div class={styles.headerActions}>
          <Badge status={status()} />
          <Show when={props.onConfigure}>
            <button
              type="button"
              class={styles.configButton}
              onClick={(e) => {
                e.stopPropagation();
                props.onConfigure?.();
              }}
              aria-label={`Configure ${props.provider.display_name ?? props.provider.name}`}
              title="Configure provider"
            >
              <Icon name="settings" size={14} />
            </button>
          </Show>
        </div>
      </div>
      <Show when={props.provider.base_url}>
        <p class={styles.url}>{props.provider.base_url}</p>
      </Show>
      <div class={styles.footer}>
        <p class={styles.count}>
          {props.modelCount} {props.modelCount === 1 ? 'model' : 'models'}
        </p>
        <div class={styles.apiKeyRow}>
          <span class={styles.apiKey}>{apiKeyDisplay()}</span>
          <Show when={props.provider.api_key}>
            <button
              type="button"
              class={styles.eyeButton}
              onClick={toggleKeyVisibility}
              aria-label={showKey() ? 'Hide API key' : 'Show API key'}
              title={showKey() ? 'Hide API key' : 'Show API key'}
            >
              <Icon name={showKey() ? 'eye-off' : 'eye'} size={14} />
            </button>
          </Show>
        </div>
      </div>
    </button>
  );
};
