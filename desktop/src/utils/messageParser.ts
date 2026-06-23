/**
 * Converts ConversationMessage domain objects into RenderedMessage UI objects
 * by splitting raw content into typed MessageBlock[].
 *
 * Block parsing rules:
 * - Fenced code blocks (```lang\n...\n```) → CodeBlock
 * - Remaining text segments → TextBlock
 * - ordered blocks from transcript → normalized in-place when available
 * - legacy reasoning/toolCalls/content fields → compatibility reconstruction
 */

import type { ConversationMessage, ParsedToolCall } from '../types/domain/message.js';
import type {
  MessageBlock, TextBlock, CodeBlock, ReasoningBlock, ToolCallBlock,
  RichContentBlock, RichContentKind, TodoListBlock, PlanBlock,
} from '../types/ui/blocks.js';
import type { RenderedMessage } from '../types/ui/message.js';

let _blockIdCounter = 0;
function nextId(): string {
  return `b${++_blockIdCounter}`;
}

const RICH_LANG_MAP: Record<string, RichContentKind> = {
  rich_chart: 'chart',
  rich_web_search: 'web_search',
  rich_image: 'image',
  rich_file: 'file',
  rich_image_text: 'image_text',
};

/** Split a markdown string into TextBlock / CodeBlock / RichContentBlock segments. */
export function parseBlocks(content: string): Array<TextBlock | CodeBlock | RichContentBlock> {
  const blocks: Array<TextBlock | CodeBlock | RichContentBlock> = [];
  // Match fenced code blocks: ```[lang][space][filename?]\n...\n```
  const fenceRe = /```([^\n`]*)\n([\s\S]*?)```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = fenceRe.exec(content)) !== null) {
    const before = content.slice(lastIndex, match.index);
    if (before.trim()) {
      blocks.push({ type: 'text', id: nextId(), content: before });
    }

    const meta = match[1].trim();
    const [langPart, filenamePart] = meta.split(/\s+/, 2);

    const richKind = RICH_LANG_MAP[langPart];
    if (richKind) {
      try {
        const data = JSON.parse(match[2].trim()) as unknown;
        blocks.push({ type: 'rich_content', id: nextId(), kind: richKind, data });
        lastIndex = match.index + match[0].length;
        continue;
      } catch { /* fall through to CodeBlock */ }
    }

    blocks.push({
      type: 'code',
      id: nextId(),
      language: langPart || null,
      filename: filenamePart ?? null,
      content: match[2],
    });

    lastIndex = match.index + match[0].length;
  }

  const tail = content.slice(lastIndex);
  if (tail.trim()) {
    blocks.push({ type: 'text', id: nextId(), content: tail });
  }

  return blocks;
}

function toolCallToBlock(tc: ParsedToolCall): ToolCallBlock {
  return {
    type: 'tool_call',
    id: nextId(),
    toolId: tc.id,
    name: tc.name,
    status: tc.status ?? 'complete',
    inputPreview: JSON.stringify(tc.arguments, null, 2),
    outputSummary: tc.outputSummary ?? null,
    inlineDiff: null,
    durationMs: tc.durationMs ?? null,
  };
}

function normalizeToolStatus(status: unknown): ToolCallBlock['status'] {
  if (status === 'streaming' || status === 'running' || status === 'complete' || status === 'error') {
    return status;
  }
  if (status === 'generating') return 'streaming';
  return 'complete';
}

export function hydratePersistedBlocks(
  blocks: MessageBlock[] | null | undefined,
  opts: { parseTextBlocks?: boolean; isStreaming?: boolean } = {},
): MessageBlock[] {
  if (!blocks || blocks.length === 0) return [];
  const parseTextBlocks = opts.parseTextBlocks ?? true;
  return blocks.flatMap((block): MessageBlock[] => {
    if (!block || typeof block !== 'object' || !('type' in block)) return [];
    switch (block.type) {
      case 'text':
        return parseTextBlocks
          ? parseBlocks((block as TextBlock).content ?? '')
          : [{ ...block, id: block.id || nextId(), content: (block as TextBlock).content ?? '' } as TextBlock];
      case 'code':
        return [{ ...block, id: block.id || nextId() } as CodeBlock];
      case 'rich_content':
        return [{ ...block, id: block.id || nextId() } as RichContentBlock];
      case 'reasoning': {
        const reasoning = block as ReasoningBlock;
        return [{
          type: 'reasoning',
          id: reasoning.id || nextId(),
          content: reasoning.content ?? '',
          isStreaming: opts.isStreaming ?? reasoning.isStreaming ?? false,
          tokenCount: reasoning.tokenCount ?? null,
        }];
      }
      case 'plan': {
        const plan = block as PlanBlock;
        return [{
          type: 'plan',
          id: plan.id || nextId(),
          content: plan.content ?? '',
          isStreaming: opts.isStreaming ?? plan.isStreaming ?? false,
        }];
      }
      case 'tool_call': {
        const tool = block as ToolCallBlock;
        const toolId = tool.toolId || tool.id || nextId();
        return [{
          type: 'tool_call',
          id: tool.id || `tc-${toolId}`,
          toolId,
          name: tool.name || 'tool',
          status: normalizeToolStatus(tool.status),
          inputPreview: tool.inputPreview ?? null,
          outputSummary: tool.outputSummary ?? null,
          inlineDiff: tool.inlineDiff ?? null,
          durationMs: tool.durationMs ?? null,
        }];
      }
      case 'todo_list':
        return [{ ...block, id: block.id || nextId(), todos: (block as TodoListBlock).todos ?? [] } as TodoListBlock];
      case 'attachment':
        return [{ ...block, id: block.id || nextId() }];
      default:
        return [];
    }
  });
}

function actionsFor(role: ConversationMessage['role']): RenderedMessage['actions'] {
  if (role === 'user') return ['copy', 'edit', 'delete'];
  if (role === 'assistant') return ['copy', 'retry', 'like', 'dislike', 'more'];
  return [];
}

/** Convert a persisted ConversationMessage into a RenderedMessage with typed blocks. */
export function parseMessage(msg: ConversationMessage): RenderedMessage {
  const blocks: MessageBlock[] = [];

  const persistedBlocks = hydratePersistedBlocks(msg.blocks, { parseTextBlocks: true, isStreaming: false });
  if (persistedBlocks.length > 0) {
    blocks.push(...persistedBlocks);
  } else if (msg.reasoning) {
    const reasoningBlock: ReasoningBlock = {
      type: 'reasoning',
      id: nextId(),
      content: msg.reasoning,
      isStreaming: false,
      tokenCount: null,
    };
    blocks.push(reasoningBlock);
  }

  if (persistedBlocks.length === 0 && msg.toolCalls) {
    // Collect todos from all tool calls to check if any todo tool produced them
    const hasAnyTodos = msg.toolCalls.some((tc) => tc.todos && tc.todos.length > 0);
    for (const tc of msg.toolCalls) {
      const hasTodos = tc.todos && tc.todos.length > 0;
      // Suppress todo tool call cards when todos are present — TodoPanel is the canonical UI
      if (!hasAnyTodos || tc.name !== 'todo') {
        blocks.push(toolCallToBlock(tc));
      }
      if (hasTodos) {
        const todoBlock: TodoListBlock = {
          type: 'todo_list',
          id: nextId(),
          toolId: tc.id,
          todos: tc.todos!,
        };
        blocks.push(todoBlock);
      }
    }
  }

  if (persistedBlocks.length === 0 && msg.content) {
    blocks.push(...parseBlocks(msg.content));
  }

  return {
    id: msg.id,
    sessionId: msg.sessionId,
    turnId: msg.turnId ?? null,
    role: msg.role,
    blocks,
    timestamp: msg.timestamp,
    tokenCount: msg.tokenCount,
    finishReason: msg.finishReason,
    isStreaming: false,
    actions: actionsFor(msg.role),
    toolName: msg.toolName ?? null,
    slashCommand: msg.slashCommand ?? undefined,
    displayParts: msg.displayParts ?? null,
    attachments: msg.attachments ?? undefined,
  };
}
