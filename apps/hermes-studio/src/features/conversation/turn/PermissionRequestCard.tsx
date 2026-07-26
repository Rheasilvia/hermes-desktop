import type { Component } from 'solid-js';
import { For, Show, createMemo, createSignal } from 'solid-js';
import type { PendingPermission } from '@/types/ui/turn.js';
import styles from './PermissionRequestCard.module.css';

interface PermissionRequestCardProps {
  permission: PendingPermission;
  onApprovalChoice: (choice: 'once' | 'session' | 'always' | 'deny') => void;
  onMaskedSubmit: (requestId: string, value: string) => void;
  onCancel: () => void;
}

type ApprovalChoice = 'once' | 'session' | 'always' | 'deny';

interface ApprovalAction {
  label: string;
  choice: ApprovalChoice;
  className: string;
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
  const [selectedActionIndex, setSelectedActionIndex] = createSignal<number | null>(null);

  const approvalActions = createMemo((): ApprovalAction[] => [
    { label: 'Deny', choice: 'deny', className: styles.denyBtn },
    ...(props.permission.isPathApproval
      ? [{ label: 'Allow for session', choice: 'session' as const, className: styles.allowBtn }]
      : []),
    { label: 'Allow', choice: 'once', className: styles.allowBtn },
  ]);

  const submitMasked = (e: Event) => {
    e.preventDefault();
    const requestId = props.permission.requestId;
    if (!requestId || value().length === 0) return;
    props.onMaskedSubmit(requestId, value());
    setValue('');
  };

  const moveSelection = (delta: 1 | -1) => {
    const actions = approvalActions();
    if (actions.length === 0) return;
    setSelectedActionIndex((current) => {
      if (current == null) return delta > 0 ? 0 : actions.length - 1;
      return (current + delta + actions.length) % actions.length;
    });
  };

  const handleCardKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      props.onCancel();
      return;
    }
    if (props.permission.kind !== 'approval') return;
    if (e.target instanceof HTMLInputElement) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      moveSelection(1);
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      moveSelection(-1);
      return;
    }
    if (e.key === 'Enter') {
      const index = selectedActionIndex();
      const action = index == null ? null : approvalActions()[index];
      if (!action) return;
      e.preventDefault();
      props.onApprovalChoice(action.choice);
    }
  };

  return (
    <div
      class={styles.card}
      role="group"
      aria-label={titleFor(props.permission.kind)}
      tabIndex={props.permission.kind === 'approval' ? 0 : undefined}
      onKeyDown={handleCardKeyDown}
    >
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
          <For each={approvalActions()}>
            {(action, index) => (
              <button
                class={action.className}
                classList={{ [styles.buttonSelected]: selectedActionIndex() === index() }}
                aria-selected={selectedActionIndex() === index()}
                onClick={() => props.onApprovalChoice(action.choice)}
              >
                {action.label}
              </button>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
};
