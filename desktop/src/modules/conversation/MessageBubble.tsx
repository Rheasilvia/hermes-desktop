import type { Component } from 'solid-js';
import { Show, For } from 'solid-js';
import type { RenderedMessage } from '@/types/index.js';
import type { TextBlock, CodeBlock, ReasoningBlock, ToolCallBlock } from '@/types/ui/blocks.js';
import { parseMarkdown } from '@/utils/markdown.js';
import { ToolCard } from './ToolCard.js';
import styles from './MessageBubble.module.css';

interface MessageBubbleProps {
  message: RenderedMessage;
}

function formatTimestamp(ts: number): string {
  try {
    return new Date(ts * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

const TextBlockView: Component<{ block: TextBlock; isAssistant: boolean }> = (props) => {
  const rendered = () =>
    props.isAssistant ? parseMarkdown(props.block.content) : props.block.content;
  return (
    <Show when={props.block.content}>
      <Show
        when={props.isAssistant}
        fallback={<div>{rendered()}</div>}
      >
        <div class={styles.markdownContent} innerHTML={rendered() as string} />
      </Show>
    </Show>
  );
};

const CodeBlockView: Component<{ block: CodeBlock }> = (props) => (
  <pre class={styles.codeBlock}>
    <Show when={props.block.language}>
      <span class={styles.codeLang}>{props.block.language}</span>
    </Show>
    <code>{props.block.content}</code>
  </pre>
);

const ReasoningBlockView: Component<{ block: ReasoningBlock }> = (props) => (
  <div class={styles.reasoningBlock}>{props.block.content}</div>
);

const ToolCallBlockView: Component<{ block: ToolCallBlock }> = (props) => (
  <ToolCard
    name={props.block.name}
    args={props.block.inputPreview ?? undefined}
    result={props.block.outputSummary ?? undefined}
    status={props.block.status === 'running' ? 'running' : props.block.status === 'error' ? 'error' : 'complete'}
  />
);

export const MessageBubble: Component<MessageBubbleProps> = (props) => {
  const role = () => props.message.role;
  const isUser = () => role() === 'user';
  const isAssistant = () => role() === 'assistant';
  const isTool = () => role() === 'tool';

  const bubbleClass = () => {
    if (isUser()) return `${styles.bubble} ${styles.userBubble}`;
    if (isAssistant()) return `${styles.bubble} ${styles.assistantBubble}`;
    return `${styles.bubble} ${styles.toolBubble}`;
  };

  return (
    <div class={styles.bubbleRow}>
      <Show when={isTool()}>
        <ToolCard
          name={props.message.toolName ?? 'tool'}
          args={
            props.message.blocks
              .filter((b): b is TextBlock => b.type === 'text')
              .map((b) => b.content)
              .join('\n') || undefined
          }
          status="complete"
        />
      </Show>

      <Show when={!isTool()}>
        <div class={styles.bubbleWrapper}>
          <div class={bubbleClass()}>
            <For each={props.message.blocks}>
              {(block) => {
                if (block.type === 'reasoning') return <ReasoningBlockView block={block as ReasoningBlock} />;
                if (block.type === 'text') return <TextBlockView block={block as TextBlock} isAssistant={isAssistant()} />;
                if (block.type === 'code') return <CodeBlockView block={block as CodeBlock} />;
                if (block.type === 'tool_call') return <ToolCallBlockView block={block as ToolCallBlock} />;
                return null;
              }}
            </For>
          </div>
          <Show when={props.message.timestamp}>
            <span class={styles.timestamp}>{formatTimestamp(props.message.timestamp)}</span>
          </Show>
        </div>
      </Show>
    </div>
  );
};
