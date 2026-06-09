import type { Accessor, Component } from 'solid-js';
import { Show, For, createEffect, createMemo, createSignal } from 'solid-js';
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
import { TurnActivityPanel } from './TurnActivityPanel.js';
import { RichContentRenderer } from './RichContentRenderer.js';
import { AttachmentRenderer } from './AttachmentRenderer.js';
import { blockToRow, liveToRow } from './toolCallMappers.js';
import { MessageActionBar, type MessageActionType } from './MessageActionBar.js';
import { Icon } from '@/ui/atoms/Icon.js';
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
  messageId?: string | number;
}

type BlockGroup =
  | { type: 'activity_group'; blocks: ToolCallBlock[] }
  | { type: 'single'; block: MessageBlock };

type ActivityGroup = Extract<BlockGroup, { type: 'activity_group' }>;
type SingleGroup = Extract<BlockGroup, { type: 'single' }>;

interface TraceSplit {
  traceBlocks: MessageBlock[];
  answerBlocks: MessageBlock[];
}

interface StableGroupSlot {
  key: string;
  group: Accessor<BlockGroup>;
  setGroup: (group: BlockGroup) => void;
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

const RichContentBlockView: Component<{ block: RichContentBlock }> = (props) => (
  <RichContentRenderer block={props.block} />
);

const AttachmentBlockView: Component<{ block: AttachmentBlock }> = (props) => (
  <AttachmentRenderer block={props.block} />
);

const ThinkingTextBlock: Component<{ block: ReasoningBlock }> = (props) => (
  <pre class={styles.thinkingText}>{props.block.content}</pre>
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

function isActivityBlock(block: MessageBlock): boolean {
  return block.type === 'reasoning' || block.type === 'tool_call' || block.type === 'todo_list';
}

function buildBlockGroups(blocks: MessageBlock[]): BlockGroup[] {
  const hasTodoList = blocks.some((b) => b.type === 'todo_list');
  const groups: BlockGroup[] = [];
  for (const block of blocks) {
    if (!isRenderableBlock(block)) {
      // Skip empty text/code blocks — don't break activity_group continuity
      continue;
    }
    if (block.type === 'reasoning') {
      groups.push({ type: 'single', block });
    } else if (block.type === 'tool_call') {
      // Suppress todo tool cards when TodoPanel is present
      if (hasTodoList && (block as ToolCallBlock).name === 'todo') continue;
      const last = groups[groups.length - 1];
      if (last?.type === 'activity_group') {
        last.blocks.push(block as ToolCallBlock);
      } else {
        groups.push({ type: 'activity_group', blocks: [block as ToolCallBlock] });
      }
    } else if (block.type === 'todo_list') {
      groups.push({ type: 'single', block });
    } else {
      groups.push({ type: 'single', block });
    }
  }
  return mergeAdjacentActivityGroups(groups);
}

function mergeAdjacentActivityGroups(groups: BlockGroup[]): BlockGroup[] {
  const merged: BlockGroup[] = [];
  for (const group of groups) {
    const previous = merged[merged.length - 1];
    if (previous?.type === 'activity_group' && group.type === 'activity_group') {
      previous.blocks.push(...group.blocks);
      continue;
    }
    merged.push(group);
  }
  return merged;
}

function blockKey(block: MessageBlock | undefined): string {
  if (!block) return 'empty';
  if (block.type === 'tool_call') return block.toolId || block.id;
  return String(block.id || block.type);
}

function baseGroupKey(group: BlockGroup, index: number): string {
  if (group.type === 'activity_group') {
    return `activity:${blockKey(group.blocks[0]) || index}`;
  }
  return `single:${group.block.type}:${blockKey(group.block) || index}`;
}

function uniqueGroupKey(group: BlockGroup, index: number, seen: Map<string, number>): string {
  const base = baseGroupKey(group, index);
  const count = seen.get(base) ?? 0;
  seen.set(base, count + 1);
  return count === 0 ? base : `${base}:${count}`;
}

function createStableGroupSlots(groups: Accessor<BlockGroup[]>): Accessor<StableGroupSlot[]> {
  const cache = new Map<string, StableGroupSlot>();
  const [slots, setSlots] = createSignal<StableGroupSlot[]>([]);

  createEffect(() => {
    const seen = new Map<string, number>();
    const activeKeys = new Set<string>();
    const nextSlots = groups().map((group, index) => {
      const key = uniqueGroupKey(group, index, seen);
      activeKeys.add(key);
      let slot = cache.get(key);
      if (!slot) {
        const [currentGroup, setCurrentGroup] = createSignal<BlockGroup>(group, { equals: false });
        slot = {
          key,
          group: currentGroup,
          setGroup: (nextGroup) => setCurrentGroup(() => nextGroup),
        };
        cache.set(key, slot);
      } else {
        slot.setGroup(group);
      }
      return slot;
    });

    for (const key of cache.keys()) {
      if (!activeKeys.has(key)) cache.delete(key);
    }
    setSlots(() => nextSlots);
  });

  return slots;
}

function splitCompletedTrace(blocks: MessageBlock[]): TraceSplit | null {
  let lastActivityIndex = -1;
  for (let i = 0; i < blocks.length; i += 1) {
    if (isRenderableBlock(blocks[i]) && isActivityBlock(blocks[i])) {
      lastActivityIndex = i;
    }
  }
  if (lastActivityIndex < 0) return null;

  const answerBlocks = blocks.slice(lastActivityIndex + 1);
  if (!answerBlocks.some(isRenderableBlock)) return null;

  return {
    traceBlocks: blocks.slice(0, lastActivityIndex + 1),
    answerBlocks,
  };
}

function traceSummary(blocks: MessageBlock[]): string {
  const toolCount = blocks.filter((block) => block.type === 'tool_call').length;
  const hasReasoning = blocks.some((block) => block.type === 'reasoning');
  const textCount = blocks.filter((block) => block.type === 'text' && block.content.trim()).length;
  const parts: string[] = [];
  if (hasReasoning) parts.push('thought');
  if (toolCount > 0) parts.push(`${toolCount} tool${toolCount !== 1 ? 's' : ''}`);
  if (textCount > 0) parts.push(`${textCount} note${textCount !== 1 ? 's' : ''}`);
  return parts.length > 0 ? `Work trace · ${parts.join(' · ')}` : 'Work trace';
}

const ActivityGroupView: Component<{
  group: Accessor<ActivityGroup>;
  embeddedActivity?: boolean;
}> = (props) => {
  const isLive = () => {
    const group = props.group();
    return group.blocks.some(
      (b) => b.status === 'streaming' || b.status === 'running'
    );
  };
  const toolRows = () => props.group().blocks.map(blockToRow);

  return (
    <TurnActivityPanel
      toolRows={toolRows()}
      isLive={isLive()}
      embedded={props.embeddedActivity}
    />
  );
};

const SingleGroupView: Component<{ group: Accessor<SingleGroup> }> = (props) => {
  const block = () => props.group().block;

  return (
    <>
      <Show when={block().type === 'text'}>
        <TextBlockView block={block() as TextBlock} />
      </Show>
      <Show when={block().type === 'code'}>
        <CodeBlock
          content={(block() as CodeBlockType).content}
          language={(block() as CodeBlockType).language}
          filename={(block() as CodeBlockType).filename}
        />
      </Show>
      <Show when={block().type === 'reasoning'}>
        <ThinkingTextBlock block={block() as ReasoningBlock} />
      </Show>
      <Show when={block().type === 'rich_content'}>
        <RichContentBlockView block={block() as RichContentBlock} />
      </Show>
      <Show when={block().type === 'attachment'}>
        <AttachmentBlockView block={block() as AttachmentBlock} />
      </Show>
    </>
  );
};

const BlockGroupView: Component<{
  slot: StableGroupSlot;
  embeddedActivity?: boolean;
}> = (props) => (
  <Show
    when={props.slot.group().type === 'activity_group'}
    fallback={<SingleGroupView group={() => props.slot.group() as SingleGroup} />}
  >
    <ActivityGroupView
      group={() => props.slot.group() as ActivityGroup}
      embeddedActivity={props.embeddedActivity}
    />
  </Show>
);

export const AssistantMessage: Component<AssistantMessageProps> = (props) => {
  const [showActions, setShowActions] = createSignal(false);
  const [traceExpanded, setTraceExpanded] = createSignal(false);

  const activeLiveRows = (): ToolCallRow[] | undefined =>
    props.liveToolRows ?? props.liveTools?.map(liveToRow);

  const traceSplit = createMemo(() => {
    if (props.isStreaming || (activeLiveRows()?.length ?? 0) > 0) return null;
    return splitCompletedTrace(props.blocks);
  });

  const blockGroups = createMemo(() =>
    buildBlockGroups(traceSplit()?.answerBlocks ?? props.blocks)
  );

  const traceGroups = createMemo(() =>
    buildBlockGroups(traceSplit()?.traceBlocks ?? [])
  );

  const blockGroupSlots = createStableGroupSlots(blockGroups);
  const traceGroupSlots = createStableGroupSlots(traceGroups);

  const hasRenderableContent = createMemo(() =>
    (activeLiveRows()?.length ?? 0) > 0 || props.blocks.some(isRenderableBlock)
  );

  const plainText = createMemo(() =>
    props.blocks
      .filter((block): block is TextBlock => block.type === 'text')
      .map((block) => block.content)
      .join('\n')
      .trim()
  );

  const playbackMessageId = createMemo(() => {
    if (props.messageId != null) return String(props.messageId);
    return props.blocks.find((block) => block.type === 'text')?.id;
  });

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
          {/* Legacy live rows path — ChatView now sends chronological blocks instead. */}
          <Show when={(activeLiveRows()?.length ?? 0) > 0}>
            <TurnActivityPanel
              toolRows={activeLiveRows()}
              isLive={
                props.isStreaming || (activeLiveRows()?.some(r => r.status === 'generating' || r.status === 'running') ?? false)
              }
            />
          </Show>
          <Show when={traceSplit()}>
            {(split) => (
              <div class={styles.workTracePanel}>
                <button
                  class={styles.workTraceHeader}
                  type="button"
                  aria-expanded={traceExpanded()}
                  onClick={() => setTraceExpanded((expanded) => !expanded)}
                >
                  <Icon name="layers" size={13} class={styles.workTraceIcon} />
                  <span class={styles.workTraceLabel}>{traceSummary(split().traceBlocks)}</span>
                  <Icon name={traceExpanded() ? 'chevron-down' : 'chevron-right'} size={13} />
                </button>
                <Show when={traceExpanded()}>
                  <div class={styles.workTraceBody}>
                    <For each={traceGroupSlots()}>
                      {(slot) => <BlockGroupView slot={slot} embeddedActivity />}
                    </For>
                  </div>
                </Show>
              </div>
            )}
          </Show>
          <For each={blockGroupSlots()}>
            {(slot) => <BlockGroupView slot={slot} />}
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
              plainText={plainText()}
              messageId={playbackMessageId()}
            />
          </Show>
        </div>
      </div>
    </Show>
  );
};
