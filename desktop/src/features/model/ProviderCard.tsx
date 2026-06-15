import type { Component } from 'solid-js';
import { Show } from 'solid-js';
import type { ProviderEntry } from '@/types/index.js';
import { Badge } from '@/ui/atoms/Badge.js';
import { Icon } from '@/ui/atoms/Icon.js';
import styles from './ProviderCard.module.css';

export interface ProviderCardProps {
  provider: ProviderEntry;
  modelCount: number;
  isActive: boolean;
  onClick: () => void;
  onConfigure?: () => void;
  onDelete?: () => void;
}

export const ProviderCard: Component<ProviderCardProps> = (props) => {
  const status = (): 'active' | 'inactive' =>
    props.provider.api_key_set ? 'active' : 'inactive';

  return (
    <button
      class={`${styles.card} ${props.isActive ? styles.active : ''}`}
      type="button"
      onClick={props.onClick}
      aria-pressed={props.isActive}
      data-testid={`provider-row-${props.provider.name}`}
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
          <Show when={props.onDelete}>
            <button
              type="button"
              class={styles.deleteButton}
              onClick={(e) => {
                e.stopPropagation();
                props.onDelete?.();
              }}
              aria-label={`Delete ${props.provider.display_name ?? props.provider.name}`}
              title="Delete provider"
            >
              <Icon name="trash-2" size={14} />
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
