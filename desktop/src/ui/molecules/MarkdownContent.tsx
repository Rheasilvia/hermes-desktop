import type { Component } from 'solid-js';
import { createEffect, createMemo } from 'solid-js';
import { highlightCodeBlocksIn, parseMarkdown } from '@/utils/markdown.js';
import styles from './MarkdownContent.module.css';

interface MarkdownContentProps {
  content: string;
  variant?: 'compact' | 'document';
  class?: string;
}

export const MarkdownContent: Component<MarkdownContentProps> = (props) => {
  let rootRef: HTMLDivElement | undefined;
  const variant = () => props.variant ?? 'document';
  const html = createMemo(() => parseMarkdown(props.content));
  const className = createMemo(() => [
    styles.root,
    variant() === 'compact' ? styles.compact : styles.document,
    props.class,
  ].filter(Boolean).join(' '));

  createEffect(() => {
    const rendered = html();
    if (!rendered || !rootRef) return;
    void highlightCodeBlocksIn(rootRef);
  });

  return (
    <div
      ref={(el) => { rootRef = el; }}
      class={className()}
      innerHTML={html()}
    />
  );
};
