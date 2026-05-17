import type { Component } from 'solid-js';
import { Show, For } from 'solid-js';
import { HermesAvatar } from '@/ui/atoms/HermesAvatar.js';
import type {
  MessageBlock,
  TextBlock,
  CodeBlock as CodeBlockType,
  ReasoningBlock,
  ToolCallBlock,
  RichContentBlock,
  AttachmentBlock,
  MessageAction,
} from '@/types/index.js';
import { parseMarkdown } from '@/utils/markdown.js';
import { CodeBlock } from './CodeBlock.js';
import { ToolCallPanel } from './ToolCallPanel.js';
import { RichContentRenderer } from './RichContentRenderer.js';
import { AttachmentRenderer } from './AttachmentRenderer.js';
import { blockToRow } from './toolCallMappers.js';
import styles from './AssistantMessage.module.css';

interface AssistantMessageProps {
  blocks: MessageBlock[];
  timestamp?: number;
  isStreaming?: boolean;
  actions?: MessageAction[];
}

function formatTimestamp(ts: number): string {
  try {
    return new Date(ts * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

const TextBlockView: Component<{ block: TextBlock }> = (props) => {
  const html = () => parseMarkdown(props.block.content);
  return <div class={styles.markdownContent} innerHTML={html()} />;
};

const ReasoningBlockView: Component<{ block: ReasoningBlock }> = (props) => (
  <div class={styles.reasoningBlock}>{props.block.content}</div>
);

const ToolCallBlockView: Component<{ block: ToolCallBlock }> = (props) => (
  <ToolCallPanel rows={[blockToRow(props.block)]} isLive={props.block.status === 'streaming'} />
);

const RichContentBlockView: Component<{ block: RichContentBlock }> = (props) => (
  <RichContentRenderer block={props.block} />
);

const AttachmentBlockView: Component<{ block: AttachmentBlock }> = (props) => (
  <AttachmentRenderer block={props.block} />
);

export const AssistantMessage: Component<AssistantMessageProps> = (props) => {
  return (
    <div class={styles.row}>
      <HermesAvatar size={40} />
      <div class={styles.content}>
        <div class={styles.header}>
          <span class={styles.senderLabel}>Hermes</span>
          <Show when={props.timestamp}>
            <span class={styles.timestamp}>{formatTimestamp(props.timestamp!)}</span>
          </Show>
        </div>
        <For each={props.blocks}>
          {(block) => {
            switch (block.type) {
              case 'text':
                return <TextBlockView block={block as TextBlock} />;
              case 'code':
                return (
                  <CodeBlock
                    content={(block as CodeBlockType).content}
                    language={(block as CodeBlockType).language}
                    filename={(block as CodeBlockType).filename}
                  />
                );
              case 'reasoning':
                return <ReasoningBlockView block={block as ReasoningBlock} />;
              case 'tool_call':
                return <ToolCallBlockView block={block as ToolCallBlock} />;
              case 'rich_content':
                return <RichContentBlockView block={block as RichContentBlock} />;
              case 'attachment':
                return <AttachmentBlockView block={block as AttachmentBlock} />;
              default:
                return null;
            }
          }}
        </For>
        <Show when={props.isStreaming}>
          <span class={styles.streamingCursor} />
        </Show>
      </div>
    </div>
  );
};
