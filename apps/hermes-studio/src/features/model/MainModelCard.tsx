import type { Component } from 'solid-js';
import { Show } from 'solid-js';
import styles from './MainModelCard.module.css';

interface Props {
  provider: string | null;
  model: string | null;
  onChangeClick: () => void;
}

export const MainModelCard: Component<Props> = (props) => {
  const hasModel = () => props.provider !== null && props.model !== null;

  return (
    <div class={styles.wrapper} data-testid="main-model-card">
      <div class={styles.accent} />
      <div class={styles.body}>
        <div>
          <div class={styles.label}>Main Model</div>
          <Show
            when={hasModel()}
            fallback={<span class={styles.placeholder}>No model configured</span>}
          >
            <span class={styles.modelLine} data-testid="main-model-display">
              {props.provider} · {props.model}
            </span>
          </Show>
        </div>
        <button
          type="button"
          class={styles.changeBtn}
          onClick={props.onChangeClick}
          aria-label={hasModel() ? 'Change main model' : 'Configure main model'}
          data-testid="main-model-change-btn"
        >
          {hasModel() ? 'Change' : 'Configure'}
        </button>
      </div>
    </div>
  );
};
