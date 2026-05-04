import type { Component } from 'solid-js';
import { createSignal, createEffect, Show } from 'solid-js';
import { Icon } from '@/components/Icon';
import styles from './MessageInput.module.css';

interface MessageInputProps {
  onSend: (text: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

export const MessageInput: Component<MessageInputProps> = (props) => {
  const [text, setText] = createSignal('');
  let textareaRef: HTMLTextAreaElement | undefined;

  const canSend = () => text().trim().length > 0 && !props.disabled;

  const handleSend = () => {
    const value = text().trim();
    if (!value || props.disabled) return;
    props.onSend(value);
    setText('');
    if (textareaRef) {
      textareaRef.style.height = 'auto';
    }
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleInput = (e: Event) => {
    const target = e.target as HTMLTextAreaElement;
    setText(target.value);
    autoResize(target);
  };

  const autoResize = (el: HTMLTextAreaElement) => {
    el.style.height = 'auto';
    const maxHeight = 200;
    const scrollHeight = el.scrollHeight;
    el.style.height = `${Math.min(scrollHeight, maxHeight)}px`;
  };

  createEffect(() => {
    if (textareaRef && text() === '') {
      textareaRef.style.height = 'auto';
    }
  });

  return (
    <div class={styles.wrapper}>
      <div class={styles.inputContainer}>
        <div class={styles.inputArea}>
          <textarea
            ref={textareaRef}
            class={styles.textarea}
            value={text()}
            onInput={handleInput}
            onKeyDown={handleKeyDown}
            placeholder={props.placeholder ?? 'Ask anything... (@ to mention tools, / for commands)'}
            disabled={props.disabled}
            rows={1}
          />
        </div>
        <div class={styles.actions}>
          <div class={styles.actionsLeft}>
            <button
              class={styles.actionBtn}
              type="button"
              aria-label="Attach file"
              disabled={props.disabled}
            >
              <Icon name="paperclip" size={16} />
            </button>
          </div>
          <Show when={canSend()}>
            <button
              class={styles.sendButton}
              onClick={handleSend}
              type="button"
              aria-label="Send message"
            >
              <Icon name="send" size={16} />
            </button>
          </Show>
        </div>
      </div>
    </div>
  );
};
