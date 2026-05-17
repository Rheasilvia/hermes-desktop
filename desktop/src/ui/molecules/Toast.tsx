import type { Component, JSX } from 'solid-js';
import { Show, createSignal, createEffect } from 'solid-js';
import { Icon } from '@/ui/atoms/Icon.js';
import type { IconName } from '@/ui/atoms/Icon.js';
import styles from './Toast.module.css';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface ToastProps {
  id: string;
  message: string;
  type?: ToastType;
  duration?: number;
  onClose: (id: string) => void;
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

  createEffect(() => {
    const duration = props.duration ?? 3000;
    const timer = setTimeout(handleClose, duration);
    return () => clearTimeout(timer);
  });

  const typeClass = () => {
    const type = props.type ?? 'info';
    return styles[type];
  };

  return (
    <div class={`${styles.toast} ${typeClass()} ${isExiting() ? styles.exiting : ''}`}>
      <span class={styles.icon}>
        <Icon name={typeIcon[props.type ?? 'info']} size={18} strokeWidth={2} />
      </span>
      <span class={styles.message}>{props.message}</span>
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
    <div class={styles.container}>
      {props.children}
    </div>
  );
};
