import type { Component } from 'solid-js';
import { createSignal, createEffect, onCleanup, onMount } from 'solid-js';
import { Icon } from '@/ui/atoms/Icon.js';
import styles from './ReasoningPanel.module.css';

export interface ReasoningPanelProps {
  content: string;
  isStreaming: boolean;
  tokenCount: number | null;
}

function formatDuration(tokenCount: number | null): string {
  if (tokenCount === null || tokenCount <= 0) return '';
  const seconds = Math.max(1, Math.round(tokenCount / 50));
  return `${seconds}s`;
}

const BAR_WIDTH = 120;
const DURATION_MS = 2000;

// JS-driven progress bar — immune to CSS animation resets from DOM updates
const ThinkingIndicator: Component = () => {
  let trackRef: HTMLDivElement | undefined;

  createEffect(() => {
    if (!trackRef) return;
    const track = trackRef;

    let rafId: number;
    let startTime = performance.now();

    function animate(now: number) {
      const elapsed = now - startTime;
      const progress = (elapsed % DURATION_MS) / DURATION_MS;
      const parentWidth = track.parentElement?.getBoundingClientRect().width ?? 0;
      const startX = -BAR_WIDTH;
      const endX = parentWidth + BAR_WIDTH;
      const x = startX + progress * (endX - startX);
      track.style.transform = `translateX(${x}px)`;
      rafId = requestAnimationFrame(animate);
    }

    rafId = requestAnimationFrame(animate);

    onCleanup(() => {
      cancelAnimationFrame(rafId);
    });
  });

  return (
    <>
      <div class={styles.inProgressHeader}>
        <Icon name="brain" size={14} class={styles.brainIcon} />
        <span class={styles.thinkingLabel}>Thinking...</span>
        <div class={styles.dotRow}>
          <span class={styles.dot} />
          <span class={styles.dot} />
          <span class={styles.dot} />
        </div>
      </div>
      <div class={styles.progressBar}>
        <div ref={(el) => { trackRef = el; }} class={styles.progressBarTrack} />
      </div>
    </>
  );
};

export const ReasoningPanel: Component<ReasoningPanelProps> = (props) => {
  const [expanded, setExpanded] = createSignal(false);

  const duration = () => formatDuration(props.tokenCount);

  // Refs for direct text updates — avoids DOM rebuild when content changes
  let inProgressTextRef: HTMLPreElement | undefined;
  let expandedTextRef: HTMLPreElement | undefined;

  createEffect(() => {
    const text = props.content;
    if (props.isStreaming) {
      if (inProgressTextRef) inProgressTextRef.textContent = text;
    } else {
      if (expandedTextRef) expandedTextRef.textContent = text;
    }
  });

  return (
    <>
      {/* In Progress — always in DOM, toggled via display+aria-hidden */}
      <div
        class={styles.inProgress}
        style={{ display: props.isStreaming ? 'flex' : 'none' }}
        aria-hidden={props.isStreaming ? undefined : 'true'}
      >
        <ThinkingIndicator />
        <pre ref={(el) => { inProgressTextRef = el; }} class={styles.reasoningText} />
      </div>

      {/* Collapsed — always in DOM, toggled via display+aria-hidden */}
      <div
        class={styles.collapsedPill}
        style={{ display: !props.isStreaming && !expanded() ? 'inline-flex' : 'none' }}
        aria-hidden={!props.isStreaming && !expanded() ? undefined : 'true'}
      >
        <Icon name="brain" size={12} class={styles.brainIconSmall} />
        <span class={styles.pillText}>
          {duration() ? `Thought for ${duration()}` : 'Thought'}
        </span>
        <span class={styles.pillSeparator} />
        <button
          class={styles.expandButton}
          onClick={() => setExpanded(true)}
          type="button"
        >
          <span>Show reasoning</span>
          <Icon name="chevron-down" size={12} />
        </button>
      </div>

      {/* Expanded — always in DOM, toggled via display+aria-hidden */}
      <div
        class={styles.expanded}
        style={{ display: !props.isStreaming && expanded() ? 'flex' : 'none' }}
        aria-hidden={!props.isStreaming && expanded() ? undefined : 'true'}
      >
        <div class={styles.expandedHeader}>
          <Icon name="brain" size={12} class={styles.brainIconSmall} />
          <span class={styles.expandedTitle}>
            {duration() ? `Reasoning · ${duration()}` : 'Reasoning'}
          </span>
          <button
            class={styles.collapseButton}
            onClick={() => setExpanded(false)}
            type="button"
          >
            <span>Hide</span>
            <Icon name="chevron-down" size={11} />
          </button>
        </div>
        <div class={styles.expandedSeparator} />
        <pre ref={(el) => { expandedTextRef = el; }} class={styles.expandedText} />
      </div>
    </>
  );
};
