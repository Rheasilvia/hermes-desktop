import type { Component } from 'solid-js';
import { Show, For } from 'solid-js';
import type { ProviderEntry, ModelOption } from '@/types/index.js';
import { Pill } from '@/ui/atoms/Pill.js';
import styles from './ModelComparison.module.css';

export interface ModelComparisonProps {
  providers: ProviderEntry[];
  activeProvider: string | null;
  activeModel: string | null;
  onSelectModel: (providerName: string, modelName: string) => void;
}

function formatContext(ctx: number | undefined): string {
  if (!ctx) return '—';
  if (ctx >= 1_000_000) return `${(ctx / 1_000_000).toFixed(0)}M`;
  if (ctx >= 1_000) return `${(ctx / 1_000).toFixed(0)}K`;
  return String(ctx);
}

function formatPrice(price: number | undefined): string {
  if (price === undefined || price === null) return '—';
  return `$${price.toFixed(3)}`;
}

export const ModelComparison: Component<ModelComparisonProps> = (props) => {
  const rows = () => {
    const items: { providerName: string; model: ModelOption }[] = [];
    for (const provider of props.providers) {
      for (const model of provider.models ?? []) {
        items.push({ providerName: provider.name, model });
      }
    }
    return items;
  };

  const isActive = (providerName: string, modelName: string): boolean =>
    props.activeProvider === providerName && props.activeModel === modelName;

  return (
    <div class={styles.tableWrapper}>
      <table class={styles.table}>
        <thead>
          <tr>
            <th class={styles.th}>Model</th>
            <th class={styles.th}>Provider</th>
            <th class={styles.th}>Context</th>
            <th class={styles.th}>Input Cost</th>
            <th class={styles.th}>Output Cost</th>
            <th class={styles.th}>Capabilities</th>
            <th class={styles.thStatus}>Status</th>
          </tr>
        </thead>
        <tbody>
          <For each={rows()}>
            {(row) => {
              const active = () => isActive(row.providerName, row.model.name);
              return (
                <tr
                  class={`${styles.row} ${active() ? styles.rowActive : ''}`}
                  onClick={() => props.onSelectModel(row.providerName, row.model.name)}
                >
                  <td class={styles.td}>
                    <span class={styles.modelName}>
                      {row.model.display_name ?? row.model.name}
                    </span>
                  </td>
                  <td class={styles.td}>
                    <span class={styles.providerLabel}>{row.providerName}</span>
                  </td>
                  <td class={styles.td}>
                    {formatContext(row.model.context_length)}
                  </td>
                  <td class={styles.td}>
                    {formatPrice(row.model.pricing_input)}
                    <span class={styles.unit}>/M tok</span>
                  </td>
                  <td class={styles.td}>
                    {formatPrice(row.model.pricing_output)}
                    <span class={styles.unit}>/M tok</span>
                  </td>
                  <td class={styles.td}>
                    <div class={styles.capabilities}>
                      <Show when={row.model.supports_vision}>
                        <Pill variant="secondary">Vision</Pill>
                      </Show>
                      <Show when={row.model.supports_function_calling}>
                        <Pill variant="secondary">Tools</Pill>
                      </Show>
                      <Show when={row.model.supports_streaming}>
                        <Pill variant="secondary">Stream</Pill>
                      </Show>
                    </div>
                  </td>
                  <td class={styles.tdStatus}>
                    <Show
                      when={active()}
                      fallback={<span class={styles.inactiveDot} />}
                    >
                      <span class={styles.activeIndicator}>Active</span>
                    </Show>
                  </td>
                </tr>
              );
            }}
          </For>
        </tbody>
      </table>
    </div>
  );
};
