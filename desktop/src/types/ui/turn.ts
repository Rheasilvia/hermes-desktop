/**
 * Ephemeral live-turn state — not persisted, exists only during active streaming.
 */

export type TurnStatus = 'idle' | 'streaming' | 'tool_running' | 'error' | 'interrupted';

export interface PendingApproval {
  command: string;
  description: string;
  is_path_approval?: boolean;
}

export interface PendingClarify {
  requestId: string;
  question: string;
  choices: string[] | null;
}

export interface MemoryContextItem {
  category: string;
  content: string;
}

import type { TodoItem } from '../gateway.js';

export interface LiveTurnState {
  sessionId: string;
  status: TurnStatus;
  streamingText: string;
  reasoningText: string;
  activeTools: LiveToolCall[];
  /** tool_id of the tool that produced the current todos batch */
  todosToolId: string | null;
  todos: TodoItem[];
  errorMessage: string | null;
  pendingApproval: PendingApproval | null;
  pendingClarify: PendingClarify | null;
  memoryContext: MemoryContextItem[] | null;
}

export interface LiveToolCall {
  id: string;
  name: string;
  status: 'generating' | 'running' | 'complete' | 'error';
  inputPreview: string | null;
  progressPreview: string | null;
  resultSummary: string | null;
  durationMs: number | null;
}
