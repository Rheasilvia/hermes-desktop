/**
 * Converts ConversationMessage domain objects into RenderedMessage UI objects
 * by splitting raw content into typed MessageBlock[].
 *
 * Block parsing rules:
 * - Fenced code blocks (```lang\n...\n```) → CodeBlock
 * - Remaining text segments → TextBlock
 * - reasoning field → ReasoningBlock (prepended before content blocks)
 * - toolCalls → ToolCallBlock (appended after content blocks)
 */

import type { ConversationMessage, ParsedToolCall } from '../types/domain/message.js';
import type {
  MessageBlock, TextBlock, CodeBlock, ReasoningBlock, ToolCallBlock,
  RichContentBlock, RichContentKind,
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
    outputSummary: null,
    inlineDiff: null,
    durationMs: null,
  };
}

function actionsFor(role: ConversationMessage['role']): RenderedMessage['actions'] {
  if (role === 'user') return ['copy', 'edit', 'delete'];
  if (role === 'assistant') return ['copy', 'retry', 'like', 'dislike', 'more'];
  return [];
}

/** Convert a persisted ConversationMessage into a RenderedMessage with typed blocks. */
export function parseMessage(msg: ConversationMessage): RenderedMessage {
  const blocks: MessageBlock[] = [];

  if (msg.reasoning) {
    const reasoningBlock: ReasoningBlock = {
      type: 'reasoning',
      id: nextId(),
      content: msg.reasoning,
      isStreaming: false,
      tokenCount: null,
    };
    blocks.push(reasoningBlock);
  }

  if (msg.toolCalls) {
    for (const tc of msg.toolCalls) {
      blocks.push(toolCallToBlock(tc));
    }
  }

  if (msg.content) {
    blocks.push(...parseBlocks(msg.content));
  }

  return {
    id: msg.id,
    sessionId: msg.sessionId,
    role: msg.role,
    blocks,
    timestamp: msg.timestamp,
    tokenCount: msg.tokenCount,
    finishReason: msg.finishReason,
    isStreaming: false,
    actions: actionsFor(msg.role),
    toolName: msg.toolName ?? null,
  };
}

/** Upgrade an ephemeral streaming RenderedMessage after message.complete. */
export function finalizeStreamingMessage(
  draft: RenderedMessage,
  persistedId: number,
  tokenCount: number | null,
  finishReason: string | null,
): RenderedMessage {
  return { ...draft, id: persistedId, tokenCount, finishReason, isStreaming: false };
}
