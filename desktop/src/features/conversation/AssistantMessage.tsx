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
  TodoListBlock,
  MessageAction,
  ToolCallRow,
  LiveToolCall,
} from '@/types/index.js';
import { parseMarkdown } from '@/utils/markdown.js';
import { CodeBlock } from './CodeBlock.js';
import { ToolCallPanel } from './ToolCallPanel.js';
import { TurnActivityPanel } from './TurnActivityPanel.js';
import { RichContentRenderer } from './RichContentRenderer.js';
import { AttachmentRenderer } from './AttachmentRenderer.js';
import { blockToRow, liveToRow } from './toolCallMappers.js';
import { MessageActionBar, type MessageActionType } from './MessageActionBar.js';
import styles from './AssistantMessage.module.css';

interface AssistantMessageProps {
  blocks: MessageBlock[];
  timestamp?: number;
  isStreaming?: boolean;
  actions?: MessageAction[];
  onAction?: (action: MessageActionType) => void;
  /** Live tool calls from the createStore array — passed raw to preserve SolidJS
   *  store-key identity so <For> only re-renders changed items. */
  liveTools?: LiveToolCall[];
  /** Pre-mapped ToolCallRow array — use when rows are already in presentation shape. */
  liveToolRows?: ToolCallRow[];
  /** Whether this is the last assistant message (controls retry button visibility). */
  isLast?: boolean;
  /** Whether action buttons should be disabled (e.g. while another turn is streaming). */
  actionsDisabled?: boolean;
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

const RichContentBlockView: Component<{ block: RichContentBlock }> = (props) => (
  <RichContentRenderer block={props.block} />
);

const AttachmentBlockView: Component<{ block: AttachmentBlock }> = (props) => (
  <AttachmentRenderer block={props.block} />
);

function isRenderableBlock(block: MessageBlock): boolean {
  switch (block.type) {
    case 'text':
    case 'code':
    case 'reasoning':
      return 'content' in block && String(block.content).trim().length > 0;
    case 'tool_call':
    case 'todo_list':
    case 'rich_content':
    case 'attachment':
      return true;
    default:
      return false;
  }
}

export const AssistantMessage: Component<AssistantMessageProps> = (props) => {
  const [showActions, setShowActions] = createSignal(false);

  // Reasoning blocks rendered outside <For> — prevents ThinkingIndicator remounts
  // on every streaming delta (new block objects would otherwise cause <For> to remount).
  const reasoningBlock = createMemo(() =>
    props.blocks.find((b) => b.type === 'reasoning') as ReasoningBlock | undefined
  );

  const blockGroups = createMemo(() => {
    const hasTodoList = props.blocks.some((b) => b.type === 'todo_list');
    const groups: BlockGroup[] = [];
    for (const block of props.blocks) {
      if (block.type === 'reasoning') continue;
      if (block.type === 'tool_call') {
        // Suppress todo tool cards when TodoPanel is present
        if (hasTodoList && (block as ToolCallBlock).name === 'todo') continue;
        const last = groups[groups.length - 1];
        if (last?.type === 'tool_group') {
          last.blocks.push(block as ToolCallBlock);
        } else {
          groups.push({ type: 'tool_group', blocks: [block as ToolCallBlock] });
        }
      } else if (block.type === 'todo_list') {
        groups.push({ type: 'single', block });
      } else {
        groups.push({ type: 'single', block });
      }
    }
    return groups;
  });

  // First tool_group — merged into TurnActivityPanel alongside reasoning
  const firstToolGroup = createMemo(() => {
    const g = blockGroups();
    return g[0]?.type === 'tool_group' ? g[0] : undefined;
  });

  // Remaining groups after TurnActivityPanel claims the first tool_group
  const remainingGroups = createMemo(() => {
    const g = blockGroups();
    return firstToolGroup() ? g.slice(1) : g;
  });

  const activeLiveRows = (): ToolCallRow[] | undefined =>
    props.liveToolRows ?? props.liveTools?.map(liveToRow);

  const hasRenderableContent = createMemo(() =>
    (activeLiveRows()?.length ?? 0) > 0 || props.blocks.some(isRenderableBlock)
  );

  return (
    <Show when={hasRenderableContent()}>
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
          {/* TurnActivityPanel outside <For> — preserves ThinkingIndicator RAF stability */}
          <Show when={reasoningBlock() || firstToolGroup() || (activeLiveRows()?.length ?? 0) > 0}>
            <TurnActivityPanel
              reasoning={reasoningBlock() ? {
                content: reasoningBlock()!.content,
                isStreaming: reasoningBlock()!.isStreaming,
                tokenCount: reasoningBlock()!.tokenCount,
              } : undefined}
              toolRows={activeLiveRows() ?? (firstToolGroup()?.blocks ?? []).map(blockToRow)}
              isLive={
                activeLiveRows()
                  ? props.isStreaming || (activeLiveRows()?.some(r => r.status === 'generating' || r.status === 'running') ?? false)
                  : (firstToolGroup()?.blocks ?? []).some(b => b.status === 'streaming' || b.status === 'running')
              }
            />
          </Show>
          <For each={remainingGroups()}>
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
                case 'rich_content':
                  return <RichContentBlockView block={block as RichContentBlock} />;
                case 'attachment':
                  return <AttachmentBlockView block={block as AttachmentBlock} />;
                default:
                  return null;
              }
            }}
          </For>
          <Show when={props.isStreaming && props.blocks.some((b) => b.type !== 'reasoning')}>
            <span class={styles.streamingCursor} />
          </Show>
          <Show when={showActions() && props.onAction}>
            <MessageActionBar
              variant="ai"
              onAction={props.onAction!}
              disabled={props.actionsDisabled}
              isLast={props.isLast}
            />
          </Show>
        </div>
      </div>
    </Show>
  );
};
