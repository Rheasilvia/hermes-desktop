import type { Component } from 'solid-js';
import { For, Show, createEffect, createSignal, onCleanup } from 'solid-js';
import { Icon } from '@/ui/atoms/Icon';
import type { DesktopPermissionMode } from '@/types/index.js';
import styles from './MessageInput.module.css';

interface PermissionModeOption {
  mode: DesktopPermissionMode;
  label: string;
  description: string;
  icon: 'lock' | 'file-check' | 'zap';
}

const OPTIONS: PermissionModeOption[] = [
  {
    mode: 'ask',
    label: 'Ask for approval',
    description: 'Ask before Hermes edits files',
    icon: 'lock',
  },
  {
    mode: 'auto',
    label: 'Approve for me',
    description: 'Auto-approve workspace file edits',
    icon: 'file-check',
  },
  {
    mode: 'full',
    label: 'Full file access',
    description: 'Dangerous commands, sudo, and secrets still ask',
    icon: 'zap',
  },
];

interface PermissionModePickerProps {
  disabled?: boolean;
  mode: DesktopPermissionMode;
  pending?: boolean;
  appliesNextTurn?: boolean;
  onChange: (mode: DesktopPermissionMode) => void;
}

export const PermissionModePicker: Component<PermissionModePickerProps> = (props) => {
  const [open, setOpen] = createSignal(false);
  let wrapRef: HTMLDivElement | undefined;
  let triggerRef: HTMLButtonElement | undefined;

  const current = () => OPTIONS.find((option) => option.mode === props.mode) ?? OPTIONS[1];

  createEffect(() => {
    if (!open()) return;

    const onPointerDown = (event: PointerEvent) => {
      if (wrapRef && event.target instanceof Node && !wrapRef.contains(event.target)) {
        setOpen(false);
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false);
        triggerRef?.focus();
      }
    };

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    onCleanup(() => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    });
  });

  const select = (mode: DesktopPermissionMode) => {
    setOpen(false);
    triggerRef?.focus();
    if (mode !== props.mode) {
      props.onChange(mode);
    }
  };

  return (
    <div ref={wrapRef} class={styles.permissionMenuWrap}>
      <button
        ref={triggerRef}
        class={`${styles.actionBtn} ${styles.permissionButton}`}
        classList={{
          [styles.permissionButtonAsk]: current().mode === 'ask',
          [styles.permissionButtonAuto]: current().mode === 'auto',
          [styles.permissionButtonFull]: current().mode === 'full',
        }}
        type="button"
        aria-label={`Permission mode: ${current().label}`}
        aria-expanded={open()}
        aria-haspopup="menu"
        disabled={props.disabled || props.pending}
        title={props.appliesNextTurn ? `${current().label} · applies next turn` : current().label}
        onClick={() => setOpen((value) => !value)}
      >
        <Icon name={current().icon} size={13} />
        <span class={styles.permissionButtonLabel}>{current().label}</span>
      </button>

      <Show when={props.appliesNextTurn}>
        <span class={styles.permissionNextTurnHint}>Applies next turn</span>
      </Show>

      <Show when={open() && !props.disabled}>
        <div class={styles.permissionMenu} role="menu" aria-label="Permission mode">
          <For each={OPTIONS}>
            {(option) => (
              <button
                type="button"
                role="menuitemradio"
                aria-checked={props.mode === option.mode}
                class={styles.permissionMenuItem}
                classList={{
                  [styles.permissionMenuItemActive]: props.mode === option.mode,
                  [styles.permissionMenuItemFull]: option.mode === 'full',
                  [styles.permissionMenuItemFullActive]: props.mode === 'full' && option.mode === 'full',
                }}
                onClick={() => select(option.mode)}
              >
                <Icon name={option.icon} size={14} />
                <span class={styles.permissionMenuText}>
                  <span class={styles.permissionMenuLabel}>{option.label}</span>
                  <span class={styles.permissionMenuDescription}>{option.description}</span>
                </span>
                <Show when={props.mode === option.mode}>
                  <Icon name="check" size={13} />
                </Show>
              </button>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
};
