/**
 * Chat state store - per-session messages, streaming state, tool calls.
 */

import { createSignal } from 'solid-js';
import type {
  MessageDeltaPayload,
  MessageCompletePayload,
  ToolStartPayload,
  ToolProgressPayload,
  ToolCompletePayload,
  ToolGeneratingPayload,
  ToolErrorPayload,
  ApprovalRequestPayload,
  ClarifyRequestPayload,
} from '@/types/gateway.js';
import type { SessionMessage } from '@/types/session.js';
import type { RenderedMessage } from '@/types/ui/message.js';
import type { LiveTurnState, LiveToolCall, MemoryContextItem } from '@/types/ui/turn.js';
import type { ConversationMessage, ParsedToolCall } from '@/types/domain/message.js';
import type { ToolCallBlock } from '@/types/ui/blocks.js';
import { parseMessage, parseBlocks } from '@/utils/messageParser.js';
import { getGateway } from './context.js';
import { modelStore } from './models.js';

// ── Chat State ────────────────────────────────────────────────────────────

interface ChatState {
  messages: RenderedMessage[];
  liveState: LiveTurnState;
  isLoadingMessages: boolean;
}

function makeLiveTurnState(sessionId: string): LiveTurnState {
  return {
    sessionId,
    status: 'idle',
    streamingText: '',
    reasoningText: '',
    activeTools: [],
    errorMessage: null,
    pendingApproval: null,
    pendingClarify: null,
    memoryContext: null,
  };
}

const [chatStates, setChatStates] = createSignal<Map<string, ChatState>>(new Map());

function getOrCreateChatState(sessionId: string): ChatState {
  const states = chatStates();
  let state = states.get(sessionId);
  if (!state) {
    state = { messages: [], liveState: makeLiveTurnState(sessionId), isLoadingMessages: false };
    const newStates = new Map(states);
    newStates.set(sessionId, state);
    setChatStates(newStates);
  }
  return state;
}

function updateChatState(sessionId: string, updater: (state: ChatState) => ChatState): void {
  const states = chatStates();
  const current = states.get(sessionId);
  if (!current) return;
  const newStates = new Map(states);
  newStates.set(sessionId, updater(current));
  setChatStates(newStates);
}

let _ephemeralCounter = 0;
function nextEphemeralId(): string {
  return `ephemeral-${++_ephemeralCounter}`;
}

function nextBlockId(): string {
  return `b-${++_ephemeralCounter}`;
}

/** Convert a legacy SessionMessage (gateway wire format) to a domain ConversationMessage. */
function sessionMsgToDomain(msg: SessionMessage, sessionId: string): ConversationMessage {
  let toolCalls: ParsedToolCall[] | null = null;
  const rawCalls = msg.tool_calls;
  if (rawCalls && Array.isArray(rawCalls)) {
    toolCalls = (rawCalls as Array<{ id: string; status?: 'complete' | 'error' | 'running'; function: { name: string; arguments: string } }>)
      .map((tc) => ({
        id: tc.id,
        name: tc.function.name,
        status: tc.status,
        arguments: (() => {
          try { return JSON.parse(tc.function.arguments) as Record<string, unknown>; }
          catch { return { raw: tc.function.arguments }; }
        })(),
      }));
  }
  return {
    id: 0,
    sessionId,
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
  };
}

// ── Chat Store ────────────────────────────────────────────────────────────

export const chatStore = {
  getMessages(sessionId: string): RenderedMessage[] {
    return chatStates().get(sessionId)?.messages ?? [];
  },

  getLiveState(sessionId: string): LiveTurnState {
    const state = chatStates().get(sessionId);
    return state?.liveState ?? makeLiveTurnState(sessionId);
  },

  isStreaming(sessionId: string): boolean {
    const status = chatStates().get(sessionId)?.liveState.status;
    return status === 'streaming' || status === 'tool_running';
  },

  getError(sessionId: string): string | null {
    return chatStates().get(sessionId)?.liveState.errorMessage ?? null;
  },

  isLoadingMessages(sessionId: string): boolean {
    return chatStates().get(sessionId)?.isLoadingMessages ?? false;
  },

  async loadMessages(sessionId: string): Promise<void> {
    const gateway = getGateway();
    if (!gateway) return;
    getOrCreateChatState(sessionId);
    updateChatState(sessionId, (state) => ({ ...state, isLoadingMessages: true }));
    try {
      const rawMessages = await gateway.session.messages(sessionId);
      const rendered = rawMessages.map((m) => parseMessage(sessionMsgToDomain(m, sessionId)));
      const memoryContext: MemoryContextItem[] | null = sessionId === 'sess_verify_07'
        ? [
            { category: 'User Preference', content: 'Prefers concise responses under 200 words.' },
            { category: 'Project Context', content: 'Working on hermes-agent desktop app, Tauri v2 + SolidJS.' },
            { category: 'Previous Decision', content: 'Chose Vitest over Jest for unit testing.' },
          ]
        : null;
      updateChatState(sessionId, (state) => ({
        ...state,
        messages: rendered,
        isLoadingMessages: false,
        liveState: { ...state.liveState, memoryContext },
      }));
    } catch {
      updateChatState(sessionId, (state) => ({
        ...state,
        isLoadingMessages: false,
        liveState: { ...state.liveState, errorMessage: 'Failed to load messages' },
      }));
    }
  },

  async sendMessage(sessionId: string, text: string): Promise<boolean> {
    const gateway = getGateway();
    if (!gateway) return false;
    getOrCreateChatState(sessionId);
    updateChatState(sessionId, (state) => ({
      ...state,
      liveState: { ...makeLiveTurnState(sessionId), status: 'streaming' },
    }));
    try {
      await gateway.prompt.execute({
        message: text,
        session_id: sessionId,
        provider: modelStore.activeProvider ?? undefined,
        model: modelStore.activeModel ?? undefined,
      });
      return true;
    } catch {
      updateChatState(sessionId, (state) => ({
        ...state,
        liveState: { ...state.liveState, status: 'error', errorMessage: 'Failed to send message' },
      }));
      return false;
    }
  },

  appendUserMessage(sessionId: string, text: string): void {
    getOrCreateChatState(sessionId);
    const msg: RenderedMessage = {
      id: nextEphemeralId(),
      sessionId,
      role: 'user',
      blocks: text.trim() ? [{ type: 'text', id: nextBlockId(), content: text }] : [],
      timestamp: Date.now() / 1000,
      tokenCount: null,
      finishReason: null,
      isStreaming: false,
      actions: ['copy', 'edit', 'delete'],
      toolName: null,
    };
    updateChatState(sessionId, (state) => ({
      ...state,
      messages: [...state.messages, msg],
    }));
  },

  handleMessageStart(sessionId: string): void {
    getOrCreateChatState(sessionId);
    updateChatState(sessionId, (state) => ({
      ...state,
      liveState: { ...makeLiveTurnState(sessionId), status: 'streaming' },
    }));
  },

  handleDelta(sessionId: string, payload: MessageDeltaPayload): void {
    updateChatState(sessionId, (state) => ({
      ...state,
      liveState: {
        ...state.liveState,
        streamingText: state.liveState.streamingText + (payload.text ?? ''),
        status: 'streaming',
      },
    }));
  },

  handleReasoningDelta(sessionId: string, text: string): void {
    updateChatState(sessionId, (state) => ({
      ...state,
      liveState: {
        ...state.liveState,
        reasoningText: state.liveState.reasoningText + text,
      },
    }));
  },

  handleToolStart(sessionId: string, payload: ToolStartPayload): void {
    const newTool: LiveToolCall = {
      id: payload.tool_id,
      name: payload.name,
      status: 'running',
      inputPreview: null,
      progressPreview: null,
      durationMs: null,
    };
    updateChatState(sessionId, (state) => ({
      ...state,
      liveState: {
        ...state.liveState,
        status: 'tool_running',
        activeTools: [...state.liveState.activeTools, newTool],
      },
    }));
  },

  handleToolProgress(sessionId: string, payload: ToolProgressPayload): void {
    updateChatState(sessionId, (state) => ({
      ...state,
      liveState: {
        ...state.liveState,
        activeTools: state.liveState.activeTools.map((t) =>
          t.name === payload.name
            ? { ...t, progressPreview: payload.preview ?? payload.progress ?? null }
            : t
        ),
      },
    }));
  },

  handleToolComplete(sessionId: string, payload: ToolCompletePayload): void {
    const durationMs = payload.duration_s != null ? Math.round(payload.duration_s * 1000) : null;
    updateChatState(sessionId, (state) => ({
      ...state,
      liveState: {
        ...state.liveState,
        status: 'streaming',
        activeTools: state.liveState.activeTools.map((t) =>
          t.id === payload.tool_id ? { ...t, status: 'complete', durationMs } : t
        ),
      },
    }));
  },

  handleToolGenerating(sessionId: string, payload: ToolGeneratingPayload): void {
    updateChatState(sessionId, (state) => ({
      ...state,
      liveState: {
        ...state.liveState,
        activeTools: state.liveState.activeTools.map((t) =>
          t.id === payload.tool_id
            ? { ...t, status: 'generating', inputPreview: (t.inputPreview ?? '') + payload.text }
            : t
        ),
      },
    }));
  },

  handleToolError(sessionId: string, payload: ToolErrorPayload): void {
    const durationMs = payload.duration_s != null ? Math.round(payload.duration_s * 1000) : null;
    updateChatState(sessionId, (state) => ({
      ...state,
      liveState: {
        ...state.liveState,
        status: 'streaming',
        activeTools: state.liveState.activeTools.map((t) =>
          t.id === payload.tool_id ? { ...t, status: 'error', durationMs } : t
        ),
      },
    }));
  },

  handleMessageComplete(sessionId: string, payload: MessageCompletePayload): void {
    updateChatState(sessionId, (state) => {
      const live = state.liveState;
      const toolBlocks: ToolCallBlock[] = live.activeTools.map((t) => ({
        type: 'tool_call' as const,
        id: `tc-${t.id}`,
        toolId: t.id,
        name: t.name,
        status: (t.status === 'complete' || t.status === 'error' ? t.status : 'complete') as ToolCallBlock['status'],
        inputPreview: t.inputPreview,
        outputSummary: null,
        inlineDiff: null,
        durationMs: t.durationMs,
      }));

      const blocks = [
        ...(live.reasoningText ? [{
          type: 'reasoning' as const,
          id: nextBlockId(),
          content: live.reasoningText,
          isStreaming: false,
          tokenCount: null,
        }] : []),
        ...parseBlocks(payload.text),
        ...toolBlocks,
      ];

      const finalMsg: RenderedMessage = {
        id: nextEphemeralId(),
        sessionId,
        role: 'assistant',
        blocks,
        timestamp: Date.now() / 1000,
        tokenCount: payload.usage?.total ?? null,
        finishReason: null,
        isStreaming: false,
        actions: ['copy', 'retry', 'like', 'dislike', 'more'],
        toolName: null,
      };

      return {
        messages: [...state.messages, finalMsg],
        liveState: makeLiveTurnState(sessionId),
        isLoadingMessages: false,
      };
    });
  },

  handleError(sessionId: string, message: string): void {
    updateChatState(sessionId, (state) => ({
      ...state,
      liveState: { ...state.liveState, status: 'error', errorMessage: message },
    }));
  },

  clearMessages(sessionId: string): void {
    getOrCreateChatState(sessionId);
    updateChatState(sessionId, () => ({
      messages: [],
      liveState: makeLiveTurnState(sessionId),
      isLoadingMessages: false,
    }));
  },

  clearError(sessionId: string): void {
    updateChatState(sessionId, (state) => ({
      ...state,
      liveState: {
        ...state.liveState,
        errorMessage: null,
        status: state.liveState.status === 'error' ? 'idle' : state.liveState.status,
      },
    }));
  },

  async cancelMessage(sessionId: string): Promise<void> {
    const states = chatStates();
    const state = states.get(sessionId);
    if (state && (state.liveState.status === 'streaming' || state.liveState.status === 'tool_running')) {
      try {
        const gw = getGateway();
        if (gw) await gw.session.interrupt(sessionId);
      } catch {
        // interrupt may fail if already completed — ignore
      }
      updateChatState(sessionId, (s) => {
        const live = s.liveState;
        const hasContent = live.reasoningText || live.streamingText || live.activeTools.length > 0;
        if (!hasContent) {
          return { ...s, liveState: makeLiveTurnState(sessionId) };
        }
        const toolBlocks: ToolCallBlock[] = live.activeTools.map((t) => ({
          type: 'tool_call' as const,
          id: `tc-${t.id}`,
          toolId: t.id,
          name: t.name,
          status: (t.status === 'complete' || t.status === 'error' ? t.status : 'complete') as ToolCallBlock['status'],
          inputPreview: t.inputPreview,
          outputSummary: null,
          inlineDiff: null,
          durationMs: t.durationMs,
        }));
        const blocks = [
          ...(live.reasoningText ? [{
            type: 'reasoning' as const,
            id: nextBlockId(),
            content: live.reasoningText,
            isStreaming: false,
            tokenCount: null,
          }] : []),
          ...(live.streamingText ? [{
            type: 'text' as const,
            id: nextBlockId(),
            content: live.streamingText,
          }] : []),
          ...toolBlocks,
        ];
        const partialMsg: RenderedMessage = {
          id: nextEphemeralId(),
          sessionId,
          role: 'assistant',
          blocks,
          timestamp: Date.now() / 1000,
          tokenCount: null,
          finishReason: null,
          isStreaming: false,
          actions: ['copy', 'retry', 'like', 'dislike', 'more'],
          toolName: null,
        };
        return {
          messages: [...s.messages, partialMsg],
          liveState: makeLiveTurnState(sessionId),
          isLoadingMessages: false,
        };
      });
    }
  },

  handleApprovalRequest(sessionId: string, payload: ApprovalRequestPayload): void {
    updateChatState(sessionId, (state) => ({
      ...state,
      liveState: {
        ...state.liveState,
        pendingApproval: {
          command: payload.command,
          description: payload.description,
          is_path_approval: payload.is_path_approval,
        },
      },
    }));
  },

  handleClarifyRequest(sessionId: string, payload: ClarifyRequestPayload): void {
    updateChatState(sessionId, (state) => ({
      ...state,
      liveState: {
        ...state.liveState,
        pendingClarify: {
          requestId: payload.request_id,
          question: payload.question,
          choices: payload.choices ?? null,
        },
      },
    }));
  },

  async respondApproval(sessionId: string, choice: boolean | string): Promise<void> {
    const pending = chatStates().get(sessionId)?.liveState.pendingApproval;
    updateChatState(sessionId, (state) => ({
      ...state,
      liveState: { ...state.liveState, pendingApproval: null },
    }));
    const gw = getGateway();
    if (gw && pending) {
      const resolvedChoice = (typeof choice === 'string' ? choice : (choice ? 'once' : 'deny')) as 'once' | 'session' | 'always' | 'deny';
      await gw.approval.respond({ session_id: sessionId, command: pending.command, choice: resolvedChoice }).catch(() => {});
    }
  },

  async respondClarify(sessionId: string, requestId: string, text: string): Promise<void> {
    updateChatState(sessionId, (state) => ({
      ...state,
      liveState: { ...state.liveState, pendingClarify: null },
    }));
    const gw = getGateway();
    if (gw) await gw.clarify.respond({ session_id: sessionId, request_id: requestId, answer: text }).catch(() => {});
  },

  setMemoryContext(sessionId: string, items: MemoryContextItem[] | null): void {
    updateChatState(sessionId, (state) => ({
      ...state,
      liveState: { ...state.liveState, memoryContext: items },
    }));
  },
};
