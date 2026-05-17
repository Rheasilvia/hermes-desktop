import type { Component } from 'solid-js';
import { createSignal, Show } from 'solid-js';
import { Icon } from '@/ui/atoms/Icon.js';
import styles from './CodeBlock.module.css';

interface CodeBlockProps {
  content: string;
  language: string | null;
  filename?: string | null;
}

export const CodeBlock: Component<CodeBlockProps> = (props) => {
  const [copied, setCopied] = createSignal(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(props.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback: silently fail — clipboard API requires secure context
    }
  };

  return (
    <div class={styles.wrapper}>
      <div class={styles.header}>
        <span class={styles.languageLabel}>
          <Show when={props.language} fallback={'text'}>
            {props.language}
          </Show>
        </span>
        <button
          class={styles.copyButton}
          onClick={handleCopy}
          type="button"
          aria-label="Copy code"
        >
          <Icon name={copied() ? 'check' : 'copy'} size={14} />
        </button>
      </div>
      <div class={styles.separator} />
      <pre class={styles.code}>
        <code>{props.content}</code>
      </pre>
    </div>
  );
};
