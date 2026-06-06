/**
 * Renderable message — the shape components receive.
 * Produced by parseMessage() from a ConversationMessage.
 */

import type { Role } from '../message.js';
import type { MessageBlock } from './blocks.js';

export type MessageActionType = 'copy' | 'retry' | 'undo' | 'edit' | 'delete' | 'branch' | 'like' | 'dislike' | 'more';
export type MessageAction = MessageActionType;

export interface RenderedMessage {
  /** number = persisted DB row id; string = ephemeral streaming message */
  id: number | string;
  sessionId: string;
  turnId?: string | null;
  role: Role;
  blocks: MessageBlock[];
  timestamp: number;
  tokenCount: number | null;
  finishReason: string | null;
  isStreaming: boolean;
  actions: MessageAction[];
  /** For role='tool' messages: the name of the tool that produced this result. */
  toolName: string | null;
  /** Local-only delivery state for optimistic messages that have not persisted. */
  deliveryStatus?: 'failed';
  /** Reader-facing reason shown when an optimistic message could not be sent. */
  failedReason?: string;
  /** Original text submitted to the backend; may differ from compact slash display text. */
  submitText?: string;
  /**
   * Set when this user message was a slash command. Drives the styled command
   * bubble (a `/command` label + the typed content). NOTE: the LLM received the
   * full expanded prompt, not this compact form.
   */
  slashCommand?: { command: string; args: string };
}
