import type { Component } from 'solid-js';
import { Show, For, createMemo, createSignal } from 'solid-js';
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
import { MessageActionBar, type MessageActionType } from './MessageActionBar.js';
import styles from './AssistantMessage.module.css';

interface AssistantMessageProps {
  blocks: MessageBlock[];
  timestamp?: number;
  isStreaming?: boolean;
  actions?: MessageAction[];
  onAction?: (action: MessageActionType) => void;
}

type BlockGroup =
  | { type: 'tool_group'; blocks: ToolCallBlock[] }
  | { type: 'single'; block: MessageBlock };

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

const RichContentBlockView: Component<{ block: RichContentBlock }> = (props) => (
  <RichContentRenderer block={props.block} />
);

const AttachmentBlockView: Component<{ block: AttachmentBlock }> = (props) => (
  <AttachmentRenderer block={props.block} />
);

export const AssistantMessage: Component<AssistantMessageProps> = (props) => {
  const [showActions, setShowActions] = createSignal(false);

  const blockGroups = createMemo(() => {
    const groups: BlockGroup[] = [];
    for (const block of props.blocks) {
      if (block.type === 'tool_call') {
        const last = groups[groups.length - 1];
        if (last?.type === 'tool_group') {
          last.blocks.push(block as ToolCallBlock);
        } else {
          groups.push({ type: 'tool_group', blocks: [block as ToolCallBlock] });
        }
      } else {
        groups.push({ type: 'single', block });
      }
    }
    return groups;
  });

  return (
    <div
      class={styles.row}
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
    >
      <HermesAvatar size={40} />
      <div class={styles.content}>
        <div class={styles.header}>
          <span class={styles.senderLabel}>Hermes</span>
          <Show when={props.timestamp}>
            <span class={styles.timestamp}>{formatTimestamp(props.timestamp!)}</span>
          </Show>
        </div>
        <For each={blockGroups()}>
          {(group) => {
            if (group.type === 'tool_group') {
              const isLive = group.blocks.some(
                (b) => b.status === 'streaming' || b.status === 'running'
              );
              return (
                <ToolCallPanel
                  rows={group.blocks.map(blockToRow)}
                  isLive={isLive}
                />
              );
            }
            const block = group.block;
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
        <Show when={showActions() && props.onAction}>
          <MessageActionBar variant="ai" onAction={props.onAction!} />
        </Show>
      </div>
    </div>
  );
};
