import type { Component } from 'solid-js';
import { Show } from 'solid-js';
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

export const ProviderCard: Component<ProviderCardProps> = (props) => {
  const status = (): 'active' | 'inactive' =>
    props.provider.enabled !== false ? 'active' : 'inactive';

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
      </div>
    </button>
  );
};
