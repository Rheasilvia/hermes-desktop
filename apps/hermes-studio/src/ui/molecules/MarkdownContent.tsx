import type { Component } from 'solid-js';
import { createEffect, createMemo } from 'solid-js';
import { highlightCodeBlocksIn, parseMarkdown, renderMathIn } from '@/utils/markdown.js';
import styles from './MarkdownContent.module.css';

interface MarkdownContentProps {
  content: string;
  variant?: 'compact' | 'document';
  class?: string;
  /** Render LaTeX math (KaTeX). Opt-in so chat currency like "$5 … $10" isn't
   *  mathified; enabled for notebook cells/outputs. */
  math?: boolean;
}

export const MarkdownContent: Component<MarkdownContentProps> = (props) => {
  let rootRef: HTMLDivElement | undefined;
  const variant = () => props.variant ?? 'document';
  const html = createMemo(() => parseMarkdown(props.content, { math: props.math }));
  const className = createMemo(() => [
    styles.root,
    variant() === 'compact' ? styles.compact : styles.document,
    props.class,
  ].filter(Boolean).join(' '));

  createEffect(() => {
    const rendered = html();
    if (!rendered || !rootRef) return;
    // Math is opt-in (avoids chat "$5 … $10" false-positives) and gated on a cheap
    // delimiter check so no-math content skips the DOM walk. Runs before Shiki
    // (disjoint nodes — math ignores pre/code).
    if (props.math && /\$|\\[([]/.test(props.content)) renderMathIn(rootRef);
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
