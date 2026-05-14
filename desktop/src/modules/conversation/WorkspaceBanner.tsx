import type { Component } from 'solid-js';
import { Show, createMemo } from 'solid-js';
import { Icon } from '@/components/Icon.js';
import styles from './WorkspaceBanner.module.css';

interface WorkspaceBannerProps {
  workspacePath: string | null;
}

export const WorkspaceBanner: Component<WorkspaceBannerProps> = (props) => {
  const exists = createMemo(() => props.workspacePath !== null);

  const broken = createMemo(() => !exists() && props.workspacePath !== null);

  return (
    <Show when={props.workspacePath}>
      <div
        class={styles.banner}
        classList={{ [styles.broken!]: broken() }}
      >
        <Show
          when={broken()}
          fallback={<Icon name="folder-open" size={14} />}
        >
          <Icon name="alert-triangle" size={14} />
        </Show>
        <span class={styles.path}>{props.workspacePath}</span>
        <Show when={broken()}>
          <span class={styles.warning}>— file tools unavailable</span>
        </Show>
      </div>
    </Show>
  );
};
