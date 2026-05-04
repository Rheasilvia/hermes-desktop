/**
 * Chat state store - per-session messages, streaming state, tool calls.
 */

import { createSignal } from 'solid-js';
import type { SessionMessage, ToolCall, MessageDelta } from '@/types/index.js';
import { getGateway } from './context.js';

interface ChatState {
  messages: SessionMessage[];
  isStreaming: boolean;
  activeToolCalls: Map<string, ToolCall>;
  currentThinking: string;
  currentReasoning: string;
  error: string | null;
}

const [chatStates, setChatStates] = createSignal<Map<string, ChatState>>(new Map());
const [streamingSessionId, setStreamingSessionId] = createSignal<string | null>(null);

function getOrCreateChatState(sessionId: string): ChatState {
  const states = chatStates();
  let state = states.get(sessionId);
  if (!state) {
    state = {
      messages: [],
      isStreaming: false,
      activeToolCalls: new Map(),
      currentThinking: '',
      currentReasoning: '',
      error: null,
    };
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

export const chatStore = {
  getMessages(sessionId: string): SessionMessage[] {
    return chatStates().get(sessionId)?.messages ?? [];
  },

  isStreaming(sessionId: string): boolean {
    return chatStates().get(sessionId)?.isStreaming ?? false;
  },

  getActiveToolCalls(sessionId: string): Map<string, ToolCall> {
    return chatStates().get(sessionId)?.activeToolCalls ?? new Map();
  },

  getCurrentThinking(sessionId: string): string {
    return chatStates().get(sessionId)?.currentThinking ?? '';
  },

  getCurrentReasoning(sessionId: string): string {
    return chatStates().get(sessionId)?.currentReasoning ?? '';
  },

  getError(sessionId: string): string | null {
    return chatStates().get(sessionId)?.error ?? null;
  },

  getStreamingSessionId(): string | null {
    return streamingSessionId();
  },

  async loadMessages(sessionId: string): Promise<void> {
    const gateway = getGateway();
    if (!gateway) return;
    try {
      const messages = await gateway.session.messages(sessionId);
      updateChatState(sessionId, (state) => ({ ...state, messages }));
    } catch {
      updateChatState(sessionId, (state) => ({ ...state, error: 'Failed to load messages' }));
    }
  },

  async sendMessage(sessionId: string, text: string): Promise<boolean> {
    const gateway = getGateway();
    if (!gateway) return false;
    updateChatState(sessionId, (state) => ({
      ...state,
      isStreaming: true,
      error: null,
      currentThinking: '',
      currentReasoning: '',
    }));
    setStreamingSessionId(sessionId);
    try {
      await gateway.prompt.execute({ message: text, session_id: sessionId });
      return true;
    } catch {
      updateChatState(sessionId, (state) => ({
        ...state,
        isStreaming: false,
        error: 'Failed to send message',
      }));
      setStreamingSessionId(null);
      return false;
    }
  },

  appendMessage(sessionId: string, message: SessionMessage): void {
    updateChatState(sessionId, (state) => ({
      ...state,
      messages: [...state.messages, message],
    }));
  },

  handleDelta(sessionId: string, delta: MessageDelta): void {
    updateChatState(sessionId, (state) => {
      const lastMessage = state.messages[state.messages.length - 1];
      if (!lastMessage || lastMessage.role !== 'assistant') {
        const newMessage: SessionMessage = {
          session_id: sessionId,
          role: 'assistant',
          content: delta.text ?? null,
          tool_call_id: null,
          tool_calls: delta.tool_calls ?? null,
          tool_name: null,
          timestamp: new Date().toISOString(),
          token_count: 0,
          finish_reason: delta.finish_reason ?? null,
          reasoning: delta.reasoning ?? null,
          reasoning_details: null,
          codex_reasoning_items: null,
        };
        return { ...state, messages: [...state.messages, newMessage] };
      }
      const updatedMessage: SessionMessage = {
        ...lastMessage,
        content: (lastMessage.content ?? '') + (delta.text ?? ''),
        tool_calls: delta.tool_calls ?? lastMessage.tool_calls,
        reasoning: delta.reasoning ?? lastMessage.reasoning,
      };
      const newMessages = [...state.messages];
      newMessages[newMessages.length - 1] = updatedMessage;
      return { ...state, messages: newMessages };
    });
  },

  handleThinkingDelta(sessionId: string, text: string): void {
    updateChatState(sessionId, (state) => ({
      ...state,
      currentThinking: state.currentThinking + text,
    }));
  },

  handleReasoningDelta(sessionId: string, text: string): void {
    updateChatState(sessionId, (state) => ({
      ...state,
      currentReasoning: state.currentReasoning + text,
    }));
  },

  handleMessageComplete(sessionId: string): void {
    updateChatState(sessionId, (state) => ({
      ...state,
      isStreaming: false,
      currentThinking: '',
      currentReasoning: '',
    }));
    if (streamingSessionId() === sessionId) {
      setStreamingSessionId(null);
    }
  },

  addToolCall(sessionId: string, toolCall: ToolCall): void {
    updateChatState(sessionId, (state) => {
      const newToolCalls = new Map(state.activeToolCalls);
      newToolCalls.set(toolCall.id, toolCall);
      return { ...state, activeToolCalls: newToolCalls };
    });
  },

  removeToolCall(sessionId: string, toolId: string): void {
    updateChatState(sessionId, (state) => {
      const newToolCalls = new Map(state.activeToolCalls);
      newToolCalls.delete(toolId);
      return { ...state, activeToolCalls: newToolCalls };
    });
  },

  clearMessages(sessionId: string): void {
    updateChatState(sessionId, (state) => ({
      ...state,
      messages: [],
      isStreaming: false,
      activeToolCalls: new Map(),
      currentThinking: '',
      currentReasoning: '',
      error: null,
    }));
  },

  clearError(sessionId: string): void {
    updateChatState(sessionId, (state) => ({ ...state, error: null }));
  },
};
