import type { Component, JSX } from 'solid-js';
import { Show, onCleanup, onMount } from 'solid-js';
import { createSignal } from 'solid-js';
import { Icon } from '@/ui/atoms/Icon.js';
import styles from './Modal.module.css';
import { Button } from '@/ui/atoms/Button.js';

export interface ModalProps {
  open: boolean;
  title?: string;
  onClose: () => void;
  children: JSX.Element;
  footer?: JSX.Element;
  style?: JSX.CSSProperties;
}

export const Modal: Component<ModalProps> = (props) => {
  const [contentRef, setContentRef] = createSignal<HTMLDivElement>();
  const [mousedownOnOverlay, setMousedownOnOverlay] = createSignal(false);

  const handleMouseDown = (e: MouseEvent) => {
    setMousedownOnOverlay(e.target === e.currentTarget);
  };

  const handleBackdropClick = (e: MouseEvent) => {
    if (e.target === e.currentTarget && mousedownOnOverlay()) {
      props.onClose();
    }
    setMousedownOnOverlay(false);
  };

  const handleEscape = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      props.onClose();
    }
  };

  onMount(() => {
    document.addEventListener('keydown', handleEscape);
  });

  onCleanup(() => {
    document.removeEventListener('keydown', handleEscape);
  });

  return (
    <Show when={props.open}>
      <div
        class={styles.overlay}
        onMouseDown={handleMouseDown}
        onClick={handleBackdropClick}
        role="dialog"
        aria-modal="true"
      >
        <div class={styles.modal} style={props.style} ref={setContentRef}>
          <div class={styles.header}>
            <Show when={props.title}>
              <h2 class={styles.title}>{props.title}</h2>
            </Show>
            <Button
              variant="ghost"
              size="sm"
              onClick={props.onClose}
              aria-label="Close"
            >
              <Icon name="x" size={16} strokeWidth={2} />
            </Button>
          </div>
          <div class={styles.body}>
            {props.children}
          </div>
          <Show when={props.footer}>
            <div class={styles.footer}>
              {props.footer}
            </div>
          </Show>
        </div>
      </div>
    </Show>
  );
};
