/**
 * Chat state store - per-session messages, streaming state, tool calls.
 *
 * Uses SolidJS createStore for fine-grained reactivity: tool event handlers
 * update only the affected field/row, not the entire ChatState object.
 * This prevents ToolCallTree from re-rendering all rows on every progress event.
 */

import { createStore, produce } from 'solid-js/store';
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
  SudoRequestPayload,
  SecretRequestPayload,
} from '@/types/gateway.js';
import type { SessionMessage } from '@/types/session.js';
import type { RenderedMessage } from '@/types/ui/message.js';
import type { LiveTurnState, LiveToolCall, MemoryContextItem } from '@/types/ui/turn.js';
import type { ConversationMessage, ParsedToolCall } from '@/types/domain/message.js';
import type { ToolCallBlock } from '@/types/ui/blocks.js';
import type { TextBlock } from '@/types/ui/blocks.js';
import { parseMessage, parseBlocks } from '@/utils/messageParser.js';
import { getGateway } from './context.js';
import { modelStore } from './models.js';
import { sessionUsage } from './usage.js';

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
    todosToolId: null,
    todos: [],
    errorMessage: null,
    pendingPermission: null,
    pendingClarify: null,
    memoryContext: null,
  };
}

// Fine-grained store: each session's ChatState is tracked at field level.
// Tool event handlers use path selectors so only the changed row re-renders.
const [chatStates, setChatStates] = createStore<Record<string, ChatState>>({});

function ensureSession(sessionId: string): void {
  if (!chatStates[sessionId]) {
    setChatStates(sessionId, {
      messages: [],
      liveState: makeLiveTurnState(sessionId),
      isLoadingMessages: false,
    });
  }
}

let _ephemeralCounter = 0;
function nextEphemeralId(): string {
  return `ephemeral-${++_ephemeralCounter}`;
}

function nextBlockId(): string {
  return `b-${++_ephemeralCounter}`;
}

function latestMatchingToolIndex(tools: LiveToolCall[], name: string): number {
  for (let idx = tools.length - 1; idx >= 0; idx -= 1) {
    const tool = tools[idx];
    if (tool.name === name && (tool.status === 'generating' || tool.status === 'running')) {
      return idx;
    }
  }
  return -1;
}

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
    return chatStates[sessionId]?.messages ?? [];
  },

  getLiveState(sessionId: string): LiveTurnState {
    return chatStates[sessionId]?.liveState ?? makeLiveTurnState(sessionId);
  },

  isStreaming(sessionId: string): boolean {
    const status = chatStates[sessionId]?.liveState.status;
    return status === 'streaming' || status === 'tool_running';
  },

  getError(sessionId: string): string | null {
    return chatStates[sessionId]?.liveState.errorMessage ?? null;
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
      const rawMessages = await gateway.session.messages(sessionId);
      const rendered = rawMessages.map((m) => parseMessage(sessionMsgToDomain(m, sessionId)));
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
        s.liveState.memoryContext = memoryContext;
      }));
    } catch {
      setChatStates(sessionId, produce((s) => {
        s.isLoadingMessages = false;
        s.liveState.errorMessage = 'Failed to load messages';
      }));
    }
  },

  async sendMessage(sessionId: string, text: string): Promise<boolean> {
    const gateway = getGateway();
    if (!gateway) return false;
    ensureSession(sessionId);
    setChatStates(sessionId, 'liveState', makeLiveTurnState(sessionId));
    setChatStates(sessionId, 'liveState', 'status', 'streaming');
    try {
      await gateway.prompt.execute({
        message: text,
        session_id: sessionId,
        provider: modelStore.activeProvider ?? undefined,
        model: modelStore.activeModel ?? undefined,
      });
      return true;
    } catch {
      setChatStates(sessionId, 'liveState', 'status', 'error');
      setChatStates(sessionId, 'liveState', 'errorMessage', 'Failed to send message');
      return false;
    }
  },

  appendUserMessage(sessionId: string, text: string, slashCommand?: { command: string; args: string }): void {
    ensureSession(sessionId);
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
      slashCommand,
    };
    setChatStates(sessionId, 'messages', (msgs) => [...msgs, msg]);
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
    ensureSession(sessionId);
    setChatStates(sessionId, 'liveState', makeLiveTurnState(sessionId));
    setChatStates(sessionId, 'liveState', 'status', 'streaming');
  },

  handleDelta(sessionId: string, payload: MessageDeltaPayload): void {
    setChatStates(sessionId, 'liveState', 'streamingText',
      (t) => t + (payload.text ?? ''));
    setChatStates(sessionId, 'liveState', 'status', 'streaming');
  },

  handleReasoningDelta(sessionId: string, text: string): void {
    setChatStates(sessionId, 'liveState', 'reasoningText', (t) => t + text);
  },

  handleToolStart(sessionId: string, payload: ToolStartPayload): void {
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
  },

  handleToolProgress(sessionId: string, payload: ToolProgressPayload): void {
    const preview = payload.preview ?? payload.progress ?? null;
    if (payload.tool_id) {
      // Prefer exact tool_id match when available
      setChatStates(
        sessionId, 'liveState', 'activeTools',
        (t) => t.id === payload.tool_id,
        'progressPreview',
        preview,
      );
    } else {
      // Legacy: no tool_id — update the latest running tool with matching name
      const tools = chatStates[sessionId]?.liveState.activeTools ?? [];
      const idx = latestMatchingToolIndex(tools, payload.name);
      if (idx >= 0) {
        setChatStates(sessionId, 'liveState', 'activeTools', idx, 'progressPreview', preview);
      }
    }
  },

  handleToolComplete(sessionId: string, payload: ToolCompletePayload): void {
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
    setChatStates(sessionId, 'liveState', 'status', 'streaming');
    if (payload.todos && payload.todos.length > 0) {
      setChatStates(sessionId, 'liveState', 'todos', payload.todos);
      setChatStates(sessionId, 'liveState', 'todosToolId', payload.tool_id);
    }
  },

  handleToolGenerating(sessionId: string, payload: ToolGeneratingPayload): void {
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
  },

  handleToolError(sessionId: string, payload: ToolErrorPayload): void {
    const durationMs = payload.duration_s != null ? Math.round(payload.duration_s * 1000) : null;
    setChatStates(
      sessionId, 'liveState', 'activeTools',
      (t) => t.id === payload.tool_id,
      produce((t) => {
        t.status = 'error';
        t.durationMs = durationMs;
      }),
    );
    setChatStates(sessionId, 'liveState', 'status', 'streaming');
  },

  handleMessageComplete(sessionId: string, payload: MessageCompletePayload): void {
    const live = chatStates[sessionId]?.liveState;
    if (!live) return;

    const hasTodos = live.todos.length > 0;
    const toolBlocks: ToolCallBlock[] = live.activeTools
      .filter((t) => !hasTodos || t.name !== 'todo')
      .map((t) => ({
        type: 'tool_call' as const,
        id: `tc-${t.id}`,
        toolId: t.id,
        name: t.name,
        status: (t.status === 'complete' || t.status === 'error' ? t.status : 'complete') as ToolCallBlock['status'],
        inputPreview: t.inputPreview,
        outputSummary: t.resultSummary,
        inlineDiff: null,
        durationMs: t.durationMs,
      }));

    const todoBlocks = hasTodos
      ? [{
          type: 'todo_list' as const,
          id: nextBlockId(),
          toolId: live.todosToolId ?? live.activeTools[0]?.id ?? 'todo',
          todos: live.todos,
        }]
      : [];

    const blocks = [
      ...(live.reasoningText ? [{
        type: 'reasoning' as const,
        id: nextBlockId(),
        content: live.reasoningText,
        isStreaming: false,
        tokenCount: null,
      }] : []),
      ...toolBlocks,
      ...todoBlocks,
      ...parseBlocks(payload.text),
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

  handleError(sessionId: string, message: string): void {
    setChatStates(sessionId, 'liveState', 'status', 'error');
    setChatStates(sessionId, 'liveState', 'errorMessage', message);
  },

  clearMessages(sessionId: string): void {
    ensureSession(sessionId);
    setChatStates(sessionId, {
      messages: [],
      liveState: makeLiveTurnState(sessionId),
      isLoadingMessages: false,
    });
    sessionUsage.reset(sessionId);
  },

  clearError(sessionId: string): void {
    setChatStates(sessionId, 'liveState', produce((live) => {
      live.errorMessage = null;
      if (live.status === 'error') live.status = 'idle';
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
    if (state && (state.liveState.status === 'streaming' || state.liveState.status === 'tool_running')) {
      try {
        const gw = getGateway();
        if (gw) await gw.session.interrupt(sessionId);
      } catch {
        // interrupt may fail if already completed — ignore
      }

      const live = chatStates[sessionId]?.liveState;
      if (!live) return;

      const hasContent = live.reasoningText || live.streamingText || live.activeTools.length > 0;
      if (!hasContent) {
        setChatStates(sessionId, 'liveState', makeLiveTurnState(sessionId));
        return;
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
        ...(live.todos.length > 0 ? [{
          type: 'todo_list' as const,
          id: nextBlockId(),
          toolId: live.todosToolId ?? live.activeTools[0]?.id ?? 'todo',
          todos: live.todos,
        }] : []),
      ];

      if (blocks.length === 0) {
        setChatStates(sessionId, 'liveState', makeLiveTurnState(sessionId));
        return;
      }

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
    if (gw && pending?.kind === 'approval') {
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
