/**
 * Chat store — transcript hydration.
 *
 * Converts persisted transcript rows (gateway wire format) into domain
 * messages, and reconstructs a LiveTurnState from a transcript's in-flight
 * live turn — reconciling it against any newer live SSE state already in the
 * store so a hydrate never clobbers fresher events.
 */

import type { TranscriptLiveTurn, TranscriptMessage } from '@/types/session.js';
import type { ConversationMessage, MessageAttachment } from '@/types/domain/message.js';
import type { LiveTurnState } from '@/types/ui/turn.js';
import type { MessageBlock } from '@/types/ui/blocks.js';
import { hydratePersistedBlocks } from '@/utils/messageParser.js';
import { chatStates, makeLiveTurnState, nextBlockId } from './chat-state.js';
import { transcriptToolToLiveTool, liveToolToBlock } from './chat-blocks.js';

/** Reconstruct domain attachments from persisted display parts so image/file
 *  chips survive a restart instead of being dropped (they were in-memory only). */
function attachmentsFromTranscript(displayParts: TranscriptMessage['display_parts']): MessageAttachment[] | null {
  if (!displayParts?.length) return null;
  const out: MessageAttachment[] = [];
  for (const part of displayParts) {
    if (part.type === 'image') {
      out.push({
        id: `image:${part.path}`,
        type: 'image',
        name: part.name,
        size: 0,
        mimeType: '',
        localPath: part.path,
      });
    }
  }
  return out.length ? out : null;
}

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
    attachments: attachmentsFromTranscript(msg.display_parts),
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
    status: liveTurn.status === 'awaiting_user' ? 'awaiting_user' : 'streaming',
    streamingText: liveTurn.content,
    reasoningText: liveTurn.reasoning,
    activityBlocks,
    activeTools,
    todos: liveTurn.todos ?? [],
    todosToolId: liveTurn.todos?.length ? (activeTools.find((tool) => tool.name === 'todo')?.id ?? null) : null,
    pendingUserInput: liveTurn.pending_user_input ? {
      requestId: liveTurn.pending_user_input.request_id,
      turnId: liveTurn.pending_user_input.turn_id ?? liveTurn.turn_id,
      questions: liveTurn.pending_user_input.questions ?? [],
    } : null,
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
