/**
 * Domain model for sessions — combines state.db and desktop.db data.
 * Used in stores and service layer; camelCase throughout.
 */

export interface ConversationSession {
  id: string;
  title: string;
  model: string;
  source: string;
  workspacePath: string | null;    // from desktop.db session_desktop_meta
  pinned: boolean;
  archived: boolean;
  lastOpenedAt: number | null;
  createdAt: number;
  lastMessageAt: number | null;
  messageCount: number;
  toolCallCount: number;
  parentSessionId: string | null;
  usage: SessionUsage;
}

export interface SessionUsage {
  inputTokens: number;
  outputTokens: number;
  cachingReadTokens: number;
  cachingWriteTokens: number;
  reasoningTokens: number;
  estimatedCostUsd: number | null;
  actualCostUsd: number | null;
  costStatus: string | null;
}
