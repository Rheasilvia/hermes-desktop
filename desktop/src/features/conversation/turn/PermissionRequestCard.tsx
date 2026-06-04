import type { Component } from 'solid-js';
import { Show, createSignal } from 'solid-js';
import type { PendingPermission } from '@/types/ui/turn.js';
import styles from './PermissionRequestCard.module.css';

interface PermissionRequestCardProps {
  permission: PendingPermission;
  onApprovalChoice: (choice: 'once' | 'session' | 'always' | 'deny') => void;
  onMaskedSubmit: (requestId: string, value: string) => void;
  onCancel: () => void;
}

function titleFor(kind: PendingPermission['kind']): string {
  switch (kind) {
    case 'sudo':
      return 'Sudo password required';
    case 'secret':
      return 'Secret required';
    default:
      return 'Waiting for approval';
  }
}

export const PermissionRequestCard: Component<PermissionRequestCardProps> = (props) => {
  const [value, setValue] = createSignal('');

  const submitMasked = (e: Event) => {
    e.preventDefault();
    const requestId = props.permission.requestId;
    if (!requestId || value().length === 0) return;
    props.onMaskedSubmit(requestId, value());
    setValue('');
  };

  return (
    <div class={styles.card}>
      <div class={styles.main}>
        <span class={styles.dots}>
          <span class={`${styles.dot} ${styles.dot1}`} />
          <span class={`${styles.dot} ${styles.dot2}`} />
          <span class={`${styles.dot} ${styles.dot3}`} />
        </span>
        <span class={styles.title}>{titleFor(props.permission.kind)}</span>
        <span class={styles.command}>{props.permission.command}</span>
        <Show when={props.permission.description}>
          <span class={styles.description}>{props.permission.description}</span>
        </Show>
      </div>

      <Show
        when={props.permission.kind === 'approval'}
        fallback={
          <form class={styles.form} onSubmit={submitMasked}>
            <input
              class={styles.maskedInput}
              type="password"
              value={value()}
              placeholder={props.permission.kind === 'sudo' ? 'Password' : 'Value'}
              autocomplete="off"
              onInput={(e) => setValue(e.currentTarget.value)}
            />
            <button class={styles.denyBtn} type="button" onClick={props.onCancel}>
              Cancel
            </button>
            <button class={styles.allowBtn} type="submit" disabled={value().length === 0}>
              Submit
            </button>
          </form>
        }
      >
        <div class={styles.buttons}>
          <button class={styles.denyBtn} onClick={() => props.onApprovalChoice('deny')}>
            Deny
          </button>
          <Show when={props.permission.isPathApproval}>
            <button class={styles.allowBtn} onClick={() => props.onApprovalChoice('session')}>
              Allow for session
            </button>
          </Show>
          <button class={styles.allowBtn} onClick={() => props.onApprovalChoice('once')}>
            Allow
          </button>
        </div>
      </Show>
    </div>
  );
};
