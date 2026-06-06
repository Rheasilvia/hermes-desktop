/**
 * Domain model for messages — parsed from DB rows.
 * tool_calls JSON string is decoded to ParsedToolCall[].
 */

import type { Role } from '../message.js';

export interface ConversationMessage {
  id: number | string;
  sessionId: string;
  turnId?: string | null;
  role: Role;
  content: string | null;
  reasoning: string | null;
  toolCalls: ParsedToolCall[] | null;
  toolCallId: string | null;
  toolName: string | null;
  timestamp: number;
  tokenCount: number | null;
  finishReason: string | null;
  /** Reserved — null until attachment feature is implemented. */
  attachments: MessageAttachment[] | null;
}

export interface ParsedToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  status?: 'complete' | 'error' | 'running';
  outputSummary?: string | null;
  durationMs?: number | null;
  /** todos attached to tool.complete when the tool is "todo" */
  todos?: import('../gateway.js').TodoItem[];
}

/**
 * User-uploaded attachment.
 * Reserved — type-specific optional fields filled in as LLM API support is added.
 */
export interface MessageAttachment {
  id: string;
  type: 'image' | 'file' | 'audio' | 'video';
  name: string;
  size: number;
  mimeType: string;
  localPath: string;
  // image
  width?: number;
  height?: number;
  // audio / video
  duration?: number;
  thumbnail?: string;
  // file (PDF etc.)
  pageCount?: number;
  preview?: string | null;
}
