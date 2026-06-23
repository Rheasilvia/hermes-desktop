/**
 * Ephemeral live-turn state — not persisted, exists only during active streaming.
 */

import type { TodoItem, UserInputQuestionPayload, UserInputAnswersPayload } from '../gateway.js';
import type { MessageBlock } from './blocks.js';

export type TurnStatus =
  | 'idle'
  | 'submitting'
  | 'accepted'
  | 'streaming'
  | 'tool_running'
  | 'awaiting_user'
  | 'finalized'
  | 'interrupted'
  | 'failed'
  | 'stale'
  | 'stalled'
  | 'error';

export interface PendingPermission {
  kind: 'approval' | 'secret' | 'sudo';
  requestId?: string;
  command: string;
  description: string;
  prompt?: string;
  envVar?: string;
  isPathApproval?: boolean;
}

export interface PendingClarify {
  requestId: string;
  question: string;
  choices: string[] | null;
}

export interface PendingUserInput {
  requestId: string;
  turnId: string | null;
  questions: UserInputQuestionPayload[];
  answers?: UserInputAnswersPayload | null;
}

export interface MemoryContextItem {
  category: string;
  content: string;
}

export interface LiveTurnState {
  sessionId: string;
  turnId: string | null;
  lastEventSeq: number | null;
  status: TurnStatus;
  streamingText: string;
  reasoningText: string;
  /** Chronological live blocks used to preserve tool/text interleaving. */
  activityBlocks: MessageBlock[];
  activeTools: LiveToolCall[];
  /** tool_id of the tool that produced the current todos batch */
  todosToolId: string | null;
  todos: TodoItem[];
  errorMessage: string | null;
  /** Optional CTA shown with the error (e.g. "Open model settings" for provider_auth). */
  errorAction: { label: string; route: string } | null;
  pendingPermission: PendingPermission | null;
  pendingClarify: PendingClarify | null;
  pendingUserInput: PendingUserInput | null;
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
