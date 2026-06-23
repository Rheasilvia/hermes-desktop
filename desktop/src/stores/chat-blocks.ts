/**
 * Chat store — activity-block + live-tool builders.
 *
 * Transforms over a session's `liveState.activityBlocks`: append streaming
 * text/reasoning, keep tool + todo blocks in sync with the live tool list, and
 * finalize the activity stream into durable message blocks when a turn
 * completes or is interrupted. They mutate the shared store via the same path
 * selectors used everywhere else, so fine-grained reactivity is preserved.
 */

import type { TodoItem } from '@/types/gateway.js';
import type { RenderedMessage } from '@/types/ui/message.js';
import type { LiveTurnState, LiveToolCall } from '@/types/ui/turn.js';
import type { ParsedToolCall } from '@/types/domain/message.js';
import type { MessageBlock, PlanBlock, ReasoningBlock, ToolCallBlock, TextBlock } from '@/types/ui/blocks.js';
import { parseBlocks } from '@/utils/messageParser.js';
import { chatStates, setChatStates, nextBlockId } from './chat-state.js';

export function latestMatchingToolIndex(tools: LiveToolCall[], name: string): number {
  for (let idx = tools.length - 1; idx >= 0; idx -= 1) {
    const tool = tools[idx];
    if (tool.name === name && (tool.status === 'generating' || tool.status === 'running')) {
      return idx;
    }
  }
  return -1;
}

export function transcriptToolToLiveTool(tool: ParsedToolCall): LiveToolCall {
  return {
    id: tool.id,
    name: tool.name,
    status: tool.status === 'error' ? 'error' : tool.status === 'complete' ? 'complete' : 'running',
    inputPreview: JSON.stringify(tool.arguments ?? {}, null, 2),
    progressPreview: null,
    resultSummary: tool.outputSummary ?? null,
    durationMs: tool.durationMs ?? null,
  };
}

export function liveToolToBlock(tool: LiveToolCall): ToolCallBlock {
  return {
    type: 'tool_call',
    id: `tc-${tool.id}`,
    toolId: tool.id,
    name: tool.name,
    status: tool.status === 'generating' ? 'streaming' : tool.status,
    inputPreview: tool.inputPreview,
    outputSummary: tool.resultSummary ?? tool.progressPreview,
    inlineDiff: null,
    durationMs: tool.durationMs,
  };
}

export function appendActivityText(sessionId: string, text: string | null | undefined): void {
  if (!text) return;
  setChatStates(sessionId, 'liveState', 'activityBlocks', (blocks) => {
    const last = blocks[blocks.length - 1];
    if (last?.type === 'text') {
      return [
        ...blocks.slice(0, -1),
        { ...last, content: last.content + text },
      ];
    }
    return [...blocks, { type: 'text' as const, id: nextBlockId(), content: text }];
  });
}

export function appendActivityReasoning(sessionId: string, text: string): void {
  if (!text) return;
  setChatStates(sessionId, 'liveState', 'activityBlocks', (blocks) => {
    const last = blocks[blocks.length - 1];
    if (last?.type === 'reasoning') {
      return [
        ...blocks.slice(0, -1),
        { ...last, content: last.content + text, isStreaming: true },
      ];
    }
    return [
      ...blocks,
      {
        type: 'reasoning' as const,
        id: nextBlockId(),
        content: text,
        isStreaming: true,
        tokenCount: null,
      },
    ];
  });
}

export function appendActivityPlan(sessionId: string, text: string): void {
  if (!text) return;
  setChatStates(sessionId, 'liveState', 'activityBlocks', (blocks) => {
    const last = blocks[blocks.length - 1];
    if (last?.type === 'plan') {
      return [
        ...blocks.slice(0, -1),
        { ...last, content: last.content + text, isStreaming: true },
      ];
    }
    return [
      ...blocks,
      {
        type: 'plan' as const,
        id: nextBlockId(),
        content: text,
        isStreaming: true,
      },
    ];
  });
}

export function completeActivityPlan(sessionId: string): void {
  setChatStates(sessionId, 'liveState', 'activityBlocks', (blocks) => {
    for (let idx = blocks.length - 1; idx >= 0; idx -= 1) {
      const block = blocks[idx];
      if (block.type === 'plan') {
        return blocks.map((item, itemIdx) =>
          itemIdx === idx ? { ...item, isStreaming: false } : item
        );
      }
    }
    return blocks;
  });
}

export function syncActivityToolBlock(sessionId: string, toolId: string): void {
  const tool = chatStates[sessionId]?.liveState.activeTools.find((item) => item.id === toolId);
  if (!tool) return;
  const nextBlock = liveToolToBlock(tool);
  setChatStates(sessionId, 'liveState', 'activityBlocks', (blocks) => {
    const idx = blocks.findIndex((block) => block.type === 'tool_call' && block.toolId === toolId);
    if (idx < 0) return [...blocks, nextBlock];
    return blocks.map((block, blockIdx) =>
      blockIdx === idx ? { ...nextBlock, id: block.id } : block
    );
  });
}

export function syncActivityTodoBlock(sessionId: string, toolId: string, todos: TodoItem[]): void {
  if (todos.length === 0) return;
  setChatStates(sessionId, 'liveState', 'activityBlocks', (blocks) => {
    const idx = blocks.findIndex((block) => block.type === 'todo_list' && block.toolId === toolId);
    const nextBlock = {
      type: 'todo_list' as const,
      id: idx >= 0 ? blocks[idx].id : nextBlockId(),
      toolId,
      todos,
    };
    if (idx < 0) return [...blocks, nextBlock];
    return blocks.map((block, blockIdx) => blockIdx === idx ? nextBlock : block);
  });
}

export function finalizeActivityBlocks(live: LiveTurnState, finalText: string | null | undefined): MessageBlock[] {
  let blocks = live.activityBlocks;
  const streamedText = blocks
    .filter((block): block is TextBlock => block.type === 'text')
    .map((block) => block.content)
    .join('');

  // message.complete.text is the final snapshot for durable assistant content,
  // not another text event. Only synthesize text when no delta arrived.
  if (finalText && !streamedText) {
    blocks = [...blocks, ...parseBlocks(finalText)];
  }

  const hasTodos = live.todos.length > 0 || blocks.some((block) => block.type === 'todo_list');
  const finalized = blocks.flatMap((block): MessageBlock[] => {
    if (block.type === 'reasoning') {
      return [{ ...block, isStreaming: false } satisfies ReasoningBlock];
    }
    if (block.type === 'plan') {
      return [{ ...block, isStreaming: false } satisfies PlanBlock];
    }
    if (block.type === 'tool_call') {
      if (hasTodos && block.name === 'todo') return [];
      return [{
        ...block,
        status: block.status === 'error' ? 'error' : 'complete',
      }];
    }
    if (block.type === 'text') {
      return parseBlocks(block.content);
    }
    return [block];
  });

  if (live.todos.length > 0 && !finalized.some((block) => block.type === 'todo_list')) {
    finalized.push({
      type: 'todo_list',
      id: nextBlockId(),
      toolId: live.todosToolId ?? live.activeTools[0]?.id ?? 'todo',
      todos: live.todos,
    });
  }

  return finalized;
}

export function interruptedBlocksFromLive(live: LiveTurnState): RenderedMessage['blocks'] {
  return finalizeActivityBlocks(live, live.streamingText);
}
