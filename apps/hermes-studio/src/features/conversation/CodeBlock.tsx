import type { Component } from 'solid-js';
import { createSignal, Show, createResource } from 'solid-js';
import { Icon } from '@/ui/atoms/Icon.js';
import { highlightCode } from '@/utils/markdown.js';
import styles from './CodeBlock.module.css';

interface CodeBlockProps {
  content: string;
  language: string | null;
  filename?: string | null;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export const CodeBlock: Component<CodeBlockProps> = (props) => {
  const [copied, setCopied] = createSignal(false);

  const [highlighted] = createResource(
    () => ({ content: props.content, language: props.language }),
    ({ content, language }) => highlightCode(content, language),
  );

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(props.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // silently fail
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
        <code
          innerHTML={highlighted() ?? escapeHtml(props.content)}
        />
      </pre>
    </div>
  );
};
