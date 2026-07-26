import type { Component } from 'solid-js';
import { Show, createMemo } from 'solid-js';
import type { ConnectionState } from '@/services/gateway/types.js';
import type { TurnStatus } from '@/types/ui/turn.js';
import { Icon } from '@/ui/atoms/Icon.js';
import styles from './ConversationRecoveryBanner.module.css';

interface RecoveryDiagnostics {
  lastEventAt: number | null;
  droppedLateEvents: number;
}

interface ConversationRecoveryBannerProps {
  turnState: TurnStatus;
  connectionState: ConnectionState;
  diagnostics: RecoveryDiagnostics;
}

interface RecoveryViewModel {
  icon: 'alert-circle' | 'loader' | 'refresh-cw';
  message: string;
  detail?: string;
  tone: 'info' | 'warning' | 'error';
}

function recoveryViewModel(
  turnState: TurnStatus,
  connectionState: ConnectionState,
  diagnostics: RecoveryDiagnostics,
): RecoveryViewModel | null {
  if (connectionState === 'reconnecting') {
    return {
      icon: 'refresh-cw',
      message: 'Reconnecting to the sidecar stream...',
      tone: 'warning',
    };
  }

  if (connectionState === 'connecting') {
    return {
      icon: 'loader',
      message: 'Connecting to the sidecar stream...',
      tone: 'info',
    };
  }

  if (connectionState === 'disconnected') {
    return {
      icon: 'alert-circle',
      message: 'Sidecar stream disconnected.',
      tone: 'error',
    };
  }

  if (turnState === 'accepted') {
    return {
      icon: 'loader',
      message: 'Backend accepted the turn. Waiting for stream...',
      tone: 'info',
    };
  }

  if (turnState === 'awaiting_user') {
    return {
      icon: 'loader',
      message: 'Waiting for your input...',
      tone: 'info',
    };
  }

  if (turnState === 'stalled') {
    return {
      icon: 'alert-circle',
      message: 'No stream events for a while. You can wait or stop this turn.',
      detail: diagnostics.droppedLateEvents > 0
        ? `${diagnostics.droppedLateEvents} late events dropped`
        : undefined,
      tone: 'warning',
    };
  }

  if (turnState === 'failed') {
    return {
      icon: 'alert-circle',
      message: 'Prompt failed before streaming. Review the failed message above or retry.',
      tone: 'error',
    };
  }

  return null;
}

export const ConversationRecoveryBanner: Component<ConversationRecoveryBannerProps> = (props) => {
  const model = createMemo(() => recoveryViewModel(props.turnState, props.connectionState, props.diagnostics));

  return (
    <Show when={model()}>
      {(item) => (
        <div
          class={styles.banner}
          classList={{
            [styles.info]: item().tone === 'info',
            [styles.warning]: item().tone === 'warning',
            [styles.error]: item().tone === 'error',
          }}
          role="status"
        >
          <Icon
            name={item().icon}
            size={14}
            class={item().icon === 'loader' ? styles.iconSpin : styles.icon}
          />
          <span class={styles.message}>{item().message}</span>
          <Show when={item().detail}>
            <span class={styles.detail}>{item().detail}</span>
          </Show>
        </div>
      )}
    </Show>
  );
};
