import type { Component } from 'solid-js';
import { Show } from 'solid-js';
import { EnvironmentPanel } from './EnvironmentPanel.js';
import styles from './ChatEnvironmentOverlay.module.css';

interface ChatEnvironmentOverlayProps {
  sessionId: string | null;
  visible: boolean;
  workspacePath: string | null;
}

export const ChatEnvironmentOverlay: Component<ChatEnvironmentOverlayProps> = (props) => (
  <Show when={props.visible}>
    <aside
      class={styles.environmentPopover}
      aria-label="Environment overview"
      data-testid="environment-panel-popover"
    >
      <EnvironmentPanel
        sessionId={props.sessionId}
        workspacePath={props.workspacePath}
      />
    </aside>
  </Show>
);
