/**
 * Chat store — transcript hydration.
 *
 * Converts persisted transcript rows (gateway wire format) into domain
 * messages, and reconstructs a LiveTurnState from a transcript's in-flight
 * live turn — reconciling it against any newer live SSE state already in the
 * store so a hydrate never clobbers fresher events.
 */

import type { TranscriptLiveTurn, TranscriptMessage } from '@/types/session.js';
import type { ConversationMessage } from '@/types/domain/message.js';
import type { LiveTurnState } from '@/types/ui/turn.js';
import type { MessageBlock } from '@/types/ui/blocks.js';
import { hydratePersistedBlocks } from '@/utils/messageParser.js';
import { chatStates, makeLiveTurnState, nextBlockId } from './chat-state.js';
import { transcriptToolToLiveTool, liveToolToBlock } from './chat-blocks.js';

export function transcriptMsgToDomain(msg: TranscriptMessage, sessionId: string): ConversationMessage {
  return {
    id: msg.id,
    sessionId,
    turnId: msg.turn_id,
    role: msg.role,
    content: msg.content,
    reasoning: msg.reasoning ?? null,
    toolCalls: msg.tool_calls ?? null,
    blocks: msg.blocks ?? null,
    toolCallId: null,
    toolName: null,
    timestamp: msg.timestamp,
    tokenCount: msg.token_count ?? null,
    finishReason: msg.finish_reason ?? null,
    attachments: null,
    slashCommand: msg.slash_command ?? null,
    displayParts: msg.display_parts ?? null,
  };
}

export function liveStateFromTranscript(sessionId: string, liveTurn: TranscriptLiveTurn | null): LiveTurnState {
  if (!liveTurn) return makeLiveTurnState(sessionId);
  const activeTools = (liveTurn.tools ?? []).map(transcriptToolToLiveTool);
  const persistedBlocks = hydratePersistedBlocks(liveTurn.blocks, {
    parseTextBlocks: false,
    isStreaming: true,
  });
  const activityBlocks: MessageBlock[] = persistedBlocks.length > 0 ? persistedBlocks : [
    ...(liveTurn.reasoning ? [{
      type: 'reasoning' as const,
      id: nextBlockId(),
      content: liveTurn.reasoning,
      isStreaming: true,
      tokenCount: null,
    }] : []),
    ...activeTools.map(liveToolToBlock),
    ...(liveTurn.content ? [{
      type: 'text' as const,
      id: nextBlockId(),
      content: liveTurn.content,
    }] : []),
  ];
  return {
    ...makeLiveTurnState(sessionId),
    turnId: liveTurn.turn_id,
    lastEventSeq: liveTurn.last_event_seq,
    status: 'streaming',
    streamingText: liveTurn.content,
    reasoningText: liveTurn.reasoning,
    activityBlocks,
    activeTools,
    todos: liveTurn.todos ?? [],
    todosToolId: liveTurn.todos?.length ? (activeTools.find((tool) => tool.name === 'todo')?.id ?? null) : null,
  };
}

export function resolveHydratedLiveState(
  sessionId: string,
  nextLiveState: LiveTurnState,
  transcriptMaxSeq: number,
): LiveTurnState {
  const current = chatStates[sessionId]?.liveState;
  if (
    current?.turnId &&
    current.lastEventSeq != null &&
    current.lastEventSeq > transcriptMaxSeq
  ) {
    return current;
  }
  if (
    current?.turnId &&
    nextLiveState.turnId === current.turnId &&
    current.lastEventSeq != null &&
    nextLiveState.lastEventSeq != null &&
    current.lastEventSeq > nextLiveState.lastEventSeq
  ) {
    return current;
  }
  return nextLiveState;
}
