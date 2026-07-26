import type { Component } from 'solid-js';
import { For, Show, createSignal } from 'solid-js';
import type { ChartData } from '@/types/index.js';
import { Modal } from '@/ui/molecules/Modal.js';
import styles from './ChartCard.module.css';

interface ChartCardProps {
  data: ChartData;
  title?: string;
}

export const ChartCard: Component<ChartCardProps> = (props) => {
  const [expanded, setExpanded] = createSignal(false);

  const maxValue = () => {
    let max = 0;
    for (const ds of props.data.datasets) {
      for (const v of ds.values) {
        if (v > max) max = v;
      }
    }
    return max || 1;
  };

  const dataset = () => props.data.datasets[0];

  const renderBars = (height: string) => (
    <div class={styles.bars} style={{ height }}>
      <For each={dataset()?.values ?? []}>
        {(value) => (
          <div
            class={styles.bar}
            style={{
              height: `${(value / maxValue()) * 100}%`,
              'background-color': dataset()?.color ?? undefined,
            }}
          />
        )}
      </For>
    </div>
  );

  const renderLabels = () => (
    <div class={styles.labels}>
      <For each={props.data.labels}>
        {(label) => <span class={styles.label}>{label}</span>}
      </For>
    </div>
  );

  return (
    <>
      <div class={styles.container} onClick={() => setExpanded(true)} style={{ cursor: 'pointer' }}>
        <Show when={props.title}>
          <div class={styles.title}>{props.title}</div>
        </Show>
        {renderBars('100px')}
        {renderLabels()}
      </div>
      <Modal
        open={expanded()}
        title={props.title ?? '图表'}
        onClose={() => setExpanded(false)}
        style={{ 'max-width': 'min(80vw, 700px)' }}
      >
        <div class={styles.expandedBody}>
          {renderBars('240px')}
          {renderLabels()}
        </div>
      </Modal>
    </>
  );
};
