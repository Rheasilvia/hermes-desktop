import type { Component, JSX } from 'solid-js';
import { For, Show, createSignal, createEffect } from 'solid-js';
import { Icon } from '@/ui/atoms/Icon.js';
import type { IconName } from '@/ui/atoms/Icon.js';
import { toastStore } from '@/stores/toast.js';
import styles from './Toast.module.css';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface ToastProps {
  id: string;
  message: string;
  type?: ToastType;
  duration?: number;
  onClose: (id: string) => void;
  actionLabel?: string;
  onAction?: () => void;
}

export const Toast: Component<ToastProps> = (props) => {
  const [isExiting, setIsExiting] = createSignal(false);

  const typeIcon: Record<ToastType, IconName> = {
    success: 'check',
    error: 'x',
    warning: 'alert-triangle',
    info: 'info',
  };

  const handleClose = () => {
    setIsExiting(true);
    setTimeout(() => {
      props.onClose(props.id);
    }, 200);
  };

  const handleAction = () => {
    props.onAction?.();
    handleClose();
  };

  createEffect(() => {
    const duration = props.duration ?? 3000;
    if (duration <= 0) return;
    const timer = setTimeout(handleClose, duration);
    return () => clearTimeout(timer);
  });

  const typeClass = () => {
    const type = props.type ?? 'info';
    return styles[type];
  };

  return (
    <div
      class={`${styles.toast} ${typeClass()} ${isExiting() ? styles.exiting : ''}`}
      role={props.type === 'error' ? 'alert' : 'status'}
      aria-live={props.type === 'error' ? 'assertive' : 'polite'}
    >
      <span class={styles.icon}>
        <Icon name={typeIcon[props.type ?? 'info']} size={18} strokeWidth={2} />
      </span>
      <span class={styles.message}>{props.message}</span>
      <Show when={props.actionLabel}>
        <button class={styles.action} onClick={handleAction}>
          {props.actionLabel}
        </button>
      </Show>
      <button class={styles.close} onClick={handleClose} aria-label="Close">
        <Icon name="x" size={14} strokeWidth={2} />
      </button>
    </div>
  );
};

export interface ToastContainerProps {
  children: JSX.Element;
}

export const ToastContainer: Component<ToastContainerProps> = (props) => {
  return (
    <div class={styles.container} aria-label="Notifications">
      {props.children}
    </div>
  );
};

/** Mounts the global toast region, driven by the toast store. Place once at the app root. */
export const ToastHost: Component = () => {
  return (
    <ToastContainer>
      <For each={toastStore.list}>
        {(entry) => (
          <Toast
            id={String(entry.id)}
            message={entry.message}
            type={entry.type}
            duration={entry.duration}
            actionLabel={entry.action?.label}
            onAction={entry.action?.onClick}
            onClose={(id) => toastStore.dismiss(Number(id))}
          />
        )}
      </For>
    </ToastContainer>
  );
};
