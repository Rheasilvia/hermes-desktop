/**
 * Chat state store - per-session messages, streaming state, tool calls.
 *
 * Uses SolidJS createStore for fine-grained reactivity: tool event handlers
 * update only the affected field/row, not the entire ChatState object.
 * This prevents ToolCallTree from re-rendering all rows on every progress event.
 */

import { produce } from 'solid-js/store';
import type {
  MessageDeltaPayload,
  MessageCompletePayload,
  ReasoningDeltaPayload,
  ToolStartPayload,
  ToolProgressPayload,
  ToolCompletePayload,
  ToolGeneratingPayload,
  ToolErrorPayload,
  ApprovalRequestPayload,
  ClarifyRequestPayload,
  SudoRequestPayload,
  SecretRequestPayload,
  ErrorPayload,
  TurnInterruptedPayload,
} from '@/types/gateway.js';
import type { SessionMessage } from '@/types/session.js';
import type { TranscriptLiveTurn, TranscriptMessage } from '@/types/session.js';
import type { RenderedMessage } from '@/types/ui/message.js';
import type { LiveTurnState, LiveToolCall, MemoryContextItem } from '@/types/ui/turn.js';
import type { ConversationMessage, ParsedToolCall } from '@/types/domain/message.js';
import type { MessageBlock } from '@/types/ui/blocks.js';
import type { TextBlock } from '@/types/ui/blocks.js';
import { parseMessage, parseBlocks, hydratePersistedBlocks } from '@/utils/messageParser.js';
import type { UserDisplayPart } from '@/features/conversation/display-parts.js';
import { getGateway } from './context.js';
import { modelStore } from './models.js';
import { sessionStore } from './session.js';
import { sessionUsage } from './usage.js';
import {
  chatStates,
  setChatStates,
  makeLiveTurnState,
  ensureSession,
  nextEphemeralId,
  nextBlockId,
  clearStalledTimer,
  noteLiveEvent,
  beginLiveTurn,
  dropIfInterrupted,
  hasAssistantForTurn,
  noteTurnEvent,
  lastEventAtBySession,
  droppedLateEventsBySession,
  interruptedBarrierBySession,
} from './chat-state.js';
import {
  latestMatchingToolIndex,
  transcriptToolToLiveTool,
  liveToolToBlock,
  appendActivityText,
  appendActivityReasoning,
  syncActivityToolBlock,
  syncActivityTodoBlock,
  finalizeActivityBlocks,
  interruptedBlocksFromLive,
} from './chat-blocks.js';
import type { ConversationDiagnosticsSnapshot } from './chat-state.js';

export type { ConversationDiagnosticsSnapshot };

// ── Transcript → domain helpers ──────────────────────────────────────────────

/** Convert a legacy SessionMessage (gateway wire format) to a domain ConversationMessage. */
function sessionMsgToDomain(msg: SessionMessage, sessionId: string): ConversationMessage {
  let toolCalls: ParsedToolCall[] | null = null;
  const rawCalls = msg.tool_calls;
  if (rawCalls && Array.isArray(rawCalls)) {
    toolCalls = (rawCalls as Array<
      | { id: string; type: 'function'; status?: 'complete' | 'error' | 'running'; function: { name: string; arguments: string } }
      | ParsedToolCall
    >).map((tc) => {
      if ('function' in tc && tc.function != null) {
        return {
          id: tc.id,
          name: tc.function.name,
          status: tc.status,
          arguments: (() => {
            try { return JSON.parse(tc.function.arguments) as Record<string, unknown>; }
            catch { return { raw: tc.function.arguments }; }
          })(),
        } satisfies ParsedToolCall;
      } else {
        const ptc = tc as ParsedToolCall;
        return {
          id: ptc.id,
          name: ptc.name,
          status: ptc.status,
          arguments: ptc.arguments,
          outputSummary: ptc.outputSummary,
          durationMs: ptc.durationMs,
        } satisfies ParsedToolCall;
      }
    });
  }
  return {
    id: 0,
    sessionId,
    turnId: (msg as unknown as { turn_id?: string }).turn_id ?? null,
    role: msg.role,
    content: msg.content,
    reasoning: msg.reasoning,
    toolCalls,
    toolCallId: msg.tool_call_id,
    toolName: msg.tool_name,
    timestamp: new Date(msg.timestamp).getTime() / 1000,
    tokenCount: msg.token_count ?? null,
    finishReason: msg.finish_reason,
    attachments: null,
    displayParts: null,
  };
}

function transcriptMsgToDomain(msg: TranscriptMessage, sessionId: string): ConversationMessage {
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

function liveStateFromTranscript(sessionId: string, liveTurn: TranscriptLiveTurn | null): LiveTurnState {
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

function resolveHydratedLiveState(
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

// ── Chat Store ────────────────────────────────────────────────────────────

export const chatStore = {
  getMessages(sessionId: string): RenderedMessage[] {
    return chatStates[sessionId]?.messages ?? [];
  },

  getLiveState(sessionId: string): LiveTurnState {
    return chatStates[sessionId]?.liveState ?? makeLiveTurnState(sessionId);
  },

  isStreaming(sessionId: string): boolean {
    const status = chatStates[sessionId]?.liveState.status;
    return status === 'submitting' || status === 'accepted' || status === 'streaming' || status === 'tool_running' || status === 'stalled';
  },

  getError(sessionId: string): string | null {
    return chatStates[sessionId]?.liveState.errorMessage ?? null;
  },

  getErrorAction(sessionId: string): { label: string; route: string } | null {
    return chatStates[sessionId]?.liveState.errorAction ?? null;
  },

  getDiagnostics(sessionId: string): ConversationDiagnosticsSnapshot {
    return {
      sessionId,
      turnState: chatStates[sessionId]?.liveState.status ?? 'idle',
      lastEventAt: lastEventAtBySession.get(sessionId) ?? null,
      droppedLateEvents: droppedLateEventsBySession.get(sessionId) ?? 0,
    };
  },

  isLoadingMessages(sessionId: string): boolean {
    return chatStates[sessionId]?.isLoadingMessages ?? false;
  },

  async loadMessages(sessionId: string): Promise<void> {
    const gateway = getGateway();
    if (!gateway) return;
    ensureSession(sessionId);
    setChatStates(sessionId, 'isLoadingMessages', true);
    try {
      const transcript = await gateway.session.transcript(sessionId);
      const rendered = transcript.messages.map((m) => parseMessage(transcriptMsgToDomain(m, sessionId)));
      const nextLiveState = resolveHydratedLiveState(
        sessionId,
        liveStateFromTranscript(sessionId, transcript.live_turn),
        transcript.max_seq,
      );
      const memoryContext: MemoryContextItem[] | null = sessionId === 'sess_verify_07'
        ? [
            { category: 'User Preference', content: 'Prefers concise responses under 200 words.' },
            { category: 'Project Context', content: 'Working on hermes-agent desktop app, Tauri v2 + SolidJS.' },
            { category: 'Previous Decision', content: 'Chose Vitest over Jest for unit testing.' },
          ]
        : null;
      setChatStates(sessionId, produce((s) => {
        s.messages = rendered;
        s.isLoadingMessages = false;
        s.liveState = nextLiveState;
        s.liveState.memoryContext = memoryContext;
      }));
    } catch {
      setChatStates(sessionId, produce((s) => {
        s.isLoadingMessages = false;
        s.liveState.errorMessage = 'Failed to load messages';
      }));
    }
  },

  async sendMessage(
    sessionId: string,
    text: string,
    opts?: { context?: string; slashCommand?: { command: string; args: string }; displayParts?: UserDisplayPart[] },
  ): Promise<boolean> {
    const gateway = getGateway();
    if (!gateway) return false;
    beginLiveTurn(sessionId, 'submitting');
    try {
      // Per-session model takes precedence; fall back to the global default.
      // (modelStore.default* is the main model, NOT the session's selection.)
      const sessionModel = sessionStore.getSessionModel(sessionId);
      const accepted = await gateway.prompt.execute({
        message: text,
        session_id: sessionId,
        provider: sessionModel?.provider ?? modelStore.defaultProvider ?? undefined,
        model: sessionModel?.model ?? modelStore.defaultModel ?? undefined,
        context: opts?.context,
        slash_command: opts?.slashCommand,
        display_parts: opts?.displayParts,
      });
      this.markPromptAccepted(sessionId, accepted.turn_id);
      return true;
    } catch {
      clearStalledTimer(sessionId);
      setChatStates(sessionId, 'liveState', 'status', 'failed');
      setChatStates(sessionId, 'liveState', 'errorMessage', 'Failed to send message');
      return false;
    }
  },

  appendUserMessage(
    sessionId: string,
    text: string,
    slashCommand?: { command: string; args: string },
    submitText = text,
    attachments?: unknown[],
    displayParts?: UserDisplayPart[],
  ): RenderedMessage['id'] {
    ensureSession(sessionId);
    const id = nextEphemeralId();
    const msg: RenderedMessage = {
      id,
      sessionId,
      role: 'user',
      blocks: text.trim() ? [{ type: 'text', id: nextBlockId(), content: text }] : [],
      timestamp: Date.now() / 1000,
      tokenCount: null,
      finishReason: null,
      isStreaming: false,
      actions: ['copy', 'edit', 'delete'],
      toolName: null,
      submitText,
      attachments,
      displayParts: displayParts?.map((part) => ({ ...part })) ?? null,
      slashCommand,
    };
    setChatStates(sessionId, 'messages', (msgs) => [...msgs, msg]);
    return id;
  },

  markUserMessageFailed(sessionId: string, messageId: RenderedMessage['id'], reason: string): boolean {
    const messages = chatStates[sessionId]?.messages ?? [];
    const index = messages.findIndex((message) => message.id === messageId && message.role === 'user');
    if (index < 0) return false;
    setChatStates(sessionId, 'messages', index, produce((message) => {
      message.deliveryStatus = 'failed';
      message.failedReason = reason;
    }));
    return true;
  },

  removeMessage(sessionId: string, messageId: RenderedMessage['id']): RenderedMessage | null {
    const messages = chatStates[sessionId]?.messages ?? [];
    const removed = messages.find((message) => message.id === messageId) ?? null;
    if (!removed) return null;
    setChatStates(sessionId, 'messages', (msgs) => msgs.filter((message) => message.id !== messageId));
    return removed;
  },

  appendLocalMessage(sessionId: string, text: string, role: 'assistant' | 'system' = 'assistant'): void {
    ensureSession(sessionId);
    const msg: RenderedMessage = {
      id: nextEphemeralId(),
      sessionId,
      role,
      blocks: text.trim() ? parseBlocks(text) : [],
      timestamp: Date.now() / 1000,
      tokenCount: null,
      finishReason: null,
      isStreaming: false,
      actions: ['copy'],
      toolName: null,
    };
    setChatStates(sessionId, 'messages', (msgs) => [...msgs, msg]);
  },

  handleMessageStart(sessionId: string): void {
    beginLiveTurn(sessionId, 'streaming');
  },

  markPromptAccepted(sessionId: string, turnId: string | null = null): void {
    beginLiveTurn(sessionId, 'accepted');
    if (turnId) setChatStates(sessionId, 'liveState', 'turnId', turnId);
  },

  handleDelta(sessionId: string, payload: MessageDeltaPayload): void {
    if (dropIfInterrupted(sessionId)) return;
    if (!noteTurnEvent(sessionId, payload)) return;
    noteLiveEvent(sessionId);
    setChatStates(sessionId, 'liveState', 'streamingText',
      (t) => t + (payload.text ?? ''));
    appendActivityText(sessionId, payload.text);
    setChatStates(sessionId, 'liveState', 'status', 'streaming');
  },

  handleReasoningDelta(sessionId: string, payloadOrText: ReasoningDeltaPayload | string): void {
    if (dropIfInterrupted(sessionId)) return;
    const payload = typeof payloadOrText === 'string'
      ? { session_id: sessionId, text: payloadOrText }
      : payloadOrText;
    if (!noteTurnEvent(sessionId, payload)) return;
    noteLiveEvent(sessionId);
    setChatStates(sessionId, 'liveState', 'reasoningText', (t) => t + payload.text);
    appendActivityReasoning(sessionId, payload.text);
  },

  handleToolStart(sessionId: string, payload: ToolStartPayload): void {
    if (dropIfInterrupted(sessionId)) return;
    if (!noteTurnEvent(sessionId, payload)) return;
    noteLiveEvent(sessionId);
    setChatStates(sessionId, 'liveState', 'status', 'tool_running');
    setChatStates(sessionId, 'liveState', 'activeTools', (tools) => {
      const existing = tools.findIndex((t) => t.id === payload.tool_id);
      if (existing >= 0) {
        // Deduplicate: update in place, preserving any accumulated inputPreview
        return tools.map((t, i) =>
          i === existing ? { ...t, name: payload.name, status: 'running' as const } : t
        );
      }
      const newTool: LiveToolCall = {
        id: payload.tool_id,
        name: payload.name,
        status: 'running',
        inputPreview: payload.context ?? null,
        progressPreview: null,
        resultSummary: null,
        durationMs: null,
      };
      return [...tools, newTool];
    });
    syncActivityToolBlock(sessionId, payload.tool_id);
  },

  handleToolProgress(sessionId: string, payload: ToolProgressPayload): void {
    if (dropIfInterrupted(sessionId)) return;
    if (!noteTurnEvent(sessionId, payload)) return;
    noteLiveEvent(sessionId);
    const preview = payload.preview ?? payload.progress ?? null;
    if (payload.tool_id) {
      // Prefer exact tool_id match when available
      setChatStates(
        sessionId, 'liveState', 'activeTools',
        (t) => t.id === payload.tool_id,
        'progressPreview',
        preview,
      );
      syncActivityToolBlock(sessionId, payload.tool_id);
    } else {
      // Legacy: no tool_id — update the latest running tool with matching name
      const tools = chatStates[sessionId]?.liveState.activeTools ?? [];
      const idx = latestMatchingToolIndex(tools, payload.name);
      if (idx >= 0) {
        setChatStates(sessionId, 'liveState', 'activeTools', idx, 'progressPreview', preview);
        const toolId = chatStates[sessionId]?.liveState.activeTools[idx]?.id;
        if (toolId) syncActivityToolBlock(sessionId, toolId);
      }
    }
  },

  handleToolComplete(sessionId: string, payload: ToolCompletePayload): void {
    if (dropIfInterrupted(sessionId)) return;
    if (!noteTurnEvent(sessionId, payload)) return;
    noteLiveEvent(sessionId);
    const durationMs = payload.duration_s != null ? Math.round(payload.duration_s * 1000) : null;
    setChatStates(
      sessionId, 'liveState', 'activeTools',
      (t) => t.id === payload.tool_id,
      produce((t) => {
        t.status = 'complete';
        t.resultSummary = payload.summary ?? null;
        t.durationMs = durationMs;
      }),
    );
    syncActivityToolBlock(sessionId, payload.tool_id);
    setChatStates(sessionId, 'liveState', 'status', 'streaming');
    if (payload.todos && payload.todos.length > 0) {
      setChatStates(sessionId, 'liveState', 'todos', payload.todos);
      setChatStates(sessionId, 'liveState', 'todosToolId', payload.tool_id);
      syncActivityTodoBlock(sessionId, payload.tool_id, payload.todos);
    }
  },

  handleToolGenerating(sessionId: string, payload: ToolGeneratingPayload): void {
    if (dropIfInterrupted(sessionId)) return;
    if (!noteTurnEvent(sessionId, payload)) return;
    noteLiveEvent(sessionId);
    setChatStates(sessionId, 'liveState', 'activeTools', (tools) => {
      const idx = tools.findIndex((t) => t.id === payload.tool_id);
      if (idx >= 0) {
        // Tool already exists — accumulate input and mark generating
        return tools.map((t, i) =>
          i === idx
            ? { ...t, status: 'generating' as const, inputPreview: (t.inputPreview ?? '') + payload.text }
            : t
        );
      }
      // Tool not yet started — pre-create it so inputPreview is ready for tool.start
      const newTool: LiveToolCall = {
        id: payload.tool_id,
        name: payload.name,
        status: 'generating',
        inputPreview: payload.text,
        progressPreview: null,
        resultSummary: null,
        durationMs: null,
      };
      return [...tools, newTool];
    });
    syncActivityToolBlock(sessionId, payload.tool_id);
  },

  handleToolError(sessionId: string, payload: ToolErrorPayload): void {
    if (dropIfInterrupted(sessionId)) return;
    if (!noteTurnEvent(sessionId, payload)) return;
    noteLiveEvent(sessionId);
    const durationMs = payload.duration_s != null ? Math.round(payload.duration_s * 1000) : null;
    setChatStates(
      sessionId, 'liveState', 'activeTools',
      (t) => t.id === payload.tool_id,
      produce((t) => {
        t.status = 'error';
        t.durationMs = durationMs;
      }),
    );
    syncActivityToolBlock(sessionId, payload.tool_id);
    setChatStates(sessionId, 'liveState', 'status', 'streaming');
  },

  handleMessageComplete(sessionId: string, payload: MessageCompletePayload): void {
    if (dropIfInterrupted(sessionId)) return;
    const turnId = payload.turn_id ?? chatStates[sessionId]?.liveState.turnId ?? null;
    if (hasAssistantForTurn(sessionId, turnId)) {
      setChatStates(sessionId, produce((s) => {
        s.liveState = makeLiveTurnState(sessionId);
        s.isLoadingMessages = false;
      }));
      return;
    }
    if (!noteTurnEvent(sessionId, payload)) return;
    noteLiveEvent(sessionId);
    clearStalledTimer(sessionId); // turn finished — stop the watchdog
    const live = chatStates[sessionId]?.liveState;
    if (!live) return;

    const blocks = [
      ...finalizeActivityBlocks(live, payload.text),
    ];

    if (blocks.length === 0) {
      setChatStates(sessionId, produce((s) => {
        s.liveState = makeLiveTurnState(sessionId);
        s.isLoadingMessages = false;
      }));
      return;
    }

    const finalMsg: RenderedMessage = {
      id: nextEphemeralId(),
      sessionId,
      turnId,
      role: 'assistant',
      blocks,
      timestamp: Date.now() / 1000,
      tokenCount: payload.usage?.total ?? null,
      finishReason: null,
      isStreaming: false,
      actions: ['copy', 'retry', 'like', 'dislike', 'more'],
      toolName: null,
    };

    setChatStates(sessionId, produce((s) => {
      s.messages = [...s.messages, finalMsg];
      s.liveState = makeLiveTurnState(sessionId);
      s.isLoadingMessages = false;
    }));

    if (payload.usage) {
      sessionUsage.update(sessionId, {
        context_used: payload.usage.context_used,
        context_max: payload.usage.context_max,
        context_percent: payload.usage.context_percent,
        cost_usd: payload.usage.cost_usd,
        total: payload.usage.total,
      });
    }
  },

  handleError(
    sessionId: string,
    payloadOrMessage: ErrorPayload | string,
    action?: { label: string; route: string } | null,
  ): void {
    const payload = typeof payloadOrMessage === 'string'
      ? { session_id: sessionId, message: payloadOrMessage }
      : payloadOrMessage;
    if (!noteTurnEvent(sessionId, payload)) return;
    clearStalledTimer(sessionId);
    setChatStates(sessionId, 'liveState', 'status', 'error');
    setChatStates(sessionId, 'liveState', 'errorMessage', payload.message);
    setChatStates(sessionId, 'liveState', 'errorAction', action ?? null);
  },

  handleTurnInterrupted(sessionId: string, payload: TurnInterruptedPayload): void {
    if (dropIfInterrupted(sessionId)) return;
    if (!noteTurnEvent(sessionId, payload)) return;
    interruptedBarrierBySession.add(sessionId);
    clearStalledTimer(sessionId);

    const live = chatStates[sessionId]?.liveState;
    if (!live) return;
    const blocks = interruptedBlocksFromLive(live);
    if (blocks.length === 0) {
      setChatStates(sessionId, 'liveState', makeLiveTurnState(sessionId));
      return;
    }

    const partialMsg: RenderedMessage = {
      id: nextEphemeralId(),
      sessionId,
      turnId: live.turnId,
      role: 'assistant',
      blocks,
      timestamp: Date.now() / 1000,
      tokenCount: null,
      finishReason: null,
      isStreaming: false,
      actions: ['copy', 'retry', 'like', 'dislike', 'more'],
      toolName: null,
    };

    setChatStates(sessionId, produce((s) => {
      s.messages = [...s.messages, partialMsg];
      s.liveState = makeLiveTurnState(sessionId);
      s.isLoadingMessages = false;
    }));
  },

  clearMessages(sessionId: string): void {
    ensureSession(sessionId);
    setChatStates(sessionId, {
      messages: [],
      liveState: makeLiveTurnState(sessionId),
      isLoadingMessages: false,
    });
    clearStalledTimer(sessionId);
    interruptedBarrierBySession.delete(sessionId);
    lastEventAtBySession.delete(sessionId);
    droppedLateEventsBySession.delete(sessionId);
    sessionUsage.reset(sessionId);
  },

  clearError(sessionId: string): void {
    setChatStates(sessionId, 'liveState', produce((live) => {
      live.errorMessage = null;
      live.errorAction = null;
      if (live.status === 'error' || live.status === 'failed') live.status = 'idle';
    }));
  },

  /**
   * Remove the last assistant turn (and optionally the preceding user message)
   * from the message list. Returns the last user message text for retry.
   */
  removeLastTurn(sessionId: string): string | null {
    const messages = chatStates[sessionId]?.messages ?? [];
    // Find the last assistant message index
    let lastAssistantIdx = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'assistant') { lastAssistantIdx = i; break; }
    }
    if (lastAssistantIdx === -1) return null;

    // Find the user message immediately before the assistant message
    let userIdx = -1;
    for (let i = lastAssistantIdx - 1; i >= 0; i--) {
      if (messages[i].role === 'user') { userIdx = i; break; }
    }

    const userMsg = userIdx !== -1 ? messages[userIdx] : null;
    const lastUserText = userMsg?.blocks
      .filter((b) => b.type === 'text')
      .map((b) => (b as TextBlock).content)
      .join('') ?? null;

    // Cut from userIdx (or lastAssistantIdx if no user msg found)
    const cutFrom = userIdx !== -1 ? userIdx : lastAssistantIdx;
    setChatStates(sessionId, 'messages', (msgs) => msgs.slice(0, cutFrom));
    return lastUserText;
  },

  async cancelMessage(sessionId: string): Promise<void> {
    const state = chatStates[sessionId];
    const cancellable = state && (
      state.liveState.status === 'submitting' ||
      state.liveState.status === 'accepted' ||
      state.liveState.status === 'streaming' ||
      state.liveState.status === 'tool_running' ||
      state.liveState.status === 'stalled'
    );
    if (cancellable) {
      try {
        const gw = getGateway();
        if (gw) await gw.session.interrupt(sessionId);
      } catch {
        // interrupt may fail if already completed — ignore
      }

      const live = chatStates[sessionId]?.liveState;
      if (!live) return;
      interruptedBarrierBySession.add(sessionId);
      clearStalledTimer(sessionId);

      const hasContent = live.reasoningText || live.streamingText || live.activeTools.length > 0;
      if (!hasContent) {
        setChatStates(sessionId, 'liveState', makeLiveTurnState(sessionId));
        return;
      }

      const blocks = finalizeActivityBlocks(live, live.streamingText);

      if (blocks.length === 0) {
        setChatStates(sessionId, 'liveState', makeLiveTurnState(sessionId));
        return;
      }

      const partialMsg: RenderedMessage = {
        id: nextEphemeralId(),
        sessionId,
        turnId: live.turnId,
        role: 'assistant',
        blocks,
        timestamp: Date.now() / 1000,
        tokenCount: null,
        finishReason: null,
        isStreaming: false,
        actions: ['copy', 'retry', 'like', 'dislike', 'more'],
        toolName: null,
      };

      setChatStates(sessionId, produce((s) => {
        s.messages = [...s.messages, partialMsg];
        s.liveState = makeLiveTurnState(sessionId);
        s.isLoadingMessages = false;
      }));
    }
  },

  handleApprovalRequest(sessionId: string, payload: ApprovalRequestPayload): void {
    setChatStates(sessionId, 'liveState', 'pendingPermission', {
      kind: 'approval',
      command: payload.command,
      description: payload.description,
      isPathApproval: payload.is_path_approval,
    });
  },

  handleSudoRequest(sessionId: string, payload: SudoRequestPayload): void {
    setChatStates(sessionId, 'liveState', 'pendingPermission', {
      kind: 'sudo',
      requestId: payload.request_id,
      command: 'sudo',
      description: 'Hermes needs your local sudo password to continue.',
    });
  },

  handleSecretRequest(sessionId: string, payload: SecretRequestPayload): void {
    setChatStates(sessionId, 'liveState', 'pendingPermission', {
      kind: 'secret',
      requestId: payload.request_id,
      command: payload.env_var,
      description: payload.prompt || `Enter ${payload.env_var}`,
      prompt: payload.prompt,
      envVar: payload.env_var,
    });
  },

  handleClarifyRequest(sessionId: string, payload: ClarifyRequestPayload): void {
    setChatStates(sessionId, 'liveState', 'pendingClarify', {
      requestId: payload.request_id,
      question: payload.question,
      choices: payload.choices ?? null,
    });
  },

  async respondApproval(sessionId: string, choice: boolean | string): Promise<void> {
    const pending = chatStates[sessionId]?.liveState.pendingPermission;
    setChatStates(sessionId, 'liveState', 'pendingPermission', null);
    const gw = getGateway();
    if (!pending) {
      console.warn('[chatStore] respondApproval: no pendingPermission for session', sessionId);
      return;
    }
    if (gw && pending.kind === 'approval') {
      const resolvedChoice = (typeof choice === 'string' ? choice : (choice ? 'once' : 'deny')) as 'once' | 'session' | 'always' | 'deny';
      await gw.approval.respond({ session_id: sessionId, command: pending.command, choice: resolvedChoice }).catch(() => {});
    }
  },

  async respondSudo(sessionId: string, requestId: string, password: string): Promise<void> {
    setChatStates(sessionId, 'liveState', 'pendingPermission', null);
    const gw = getGateway();
    if (gw) await gw.sudo.respond({ request_id: requestId, password }).catch(() => {});
  },

  async respondSecret(sessionId: string, requestId: string, value: string): Promise<void> {
    setChatStates(sessionId, 'liveState', 'pendingPermission', null);
    const gw = getGateway();
    if (gw) await gw.secret.respond({ request_id: requestId, value }).catch(() => {});
  },

  async respondClarify(sessionId: string, requestId: string, text: string): Promise<void> {
    setChatStates(sessionId, 'liveState', 'pendingClarify', null);
    const gw = getGateway();
    if (gw) await gw.clarify.respond({ session_id: sessionId, request_id: requestId, answer: text }).catch(() => {});
  },

  setMemoryContext(sessionId: string, items: MemoryContextItem[] | null): void {
    setChatStates(sessionId, 'liveState', 'memoryContext', items);
  },
};
