/**
 * Renderable message — the shape components receive.
 * Produced by parseMessage() from a ConversationMessage.
 */

import type { Role } from '../message.js';
import type { MessageBlock } from './blocks.js';

export type MessageAction = 'copy' | 'retry' | 'branch' | 'edit';

export interface RenderedMessage {
  /** number = persisted DB row id; string = ephemeral streaming message */
  id: number | string;
  sessionId: string;
  role: Role;
  blocks: MessageBlock[];
  timestamp: number;
  tokenCount: number | null;
  finishReason: string | null;
  isStreaming: boolean;
  actions: MessageAction[];
  /** For role='tool' messages: the name of the tool that produced this result. */
  toolName: string | null;
}
