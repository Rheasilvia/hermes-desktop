/**
 * MessageBlock union — typed building blocks composing a rendered message.
 * Components switch on block.type to render the appropriate widget.
 */

import type { MessageAttachment } from '../domain/message.js';

export type MessageBlock =
  | TextBlock
  | CodeBlock
  | ToolCallBlock
  | ReasoningBlock
  | RichContentBlock
  | AttachmentBlock
  | TodoListBlock;

export interface TodoListBlock {
  type: 'todo_list';
  id: string;
  toolId: string;
  todos: import('../gateway.js').TodoItem[];
}

export interface TextBlock {
  type: 'text';
  id: string;
  content: string;
}

export interface CodeBlock {
  type: 'code';
  id: string;
  language: string | null;
  filename: string | null;
  content: string;
}

export interface ReasoningBlock {
  type: 'reasoning';
  id: string;
  content: string;
  isStreaming: boolean;
  tokenCount: number | null;
}

export interface ToolCallBlock {
  type: 'tool_call';
  id: string;
  toolId: string;
  name: string;
  status: 'streaming' | 'running' | 'complete' | 'error';
  inputPreview: string | null;
  outputSummary: string | null;
  inlineDiff: string | null;  // raw unified diff text from tool.complete event
  durationMs: number | null;
}

export type RichContentKind = 'chart' | 'web_search' | 'image' | 'file' | 'image_text';

export interface RichContentBlock {
  type: 'rich_content';
  id: string;
  kind: RichContentKind;
  data: unknown;
}

/** Reserved — rendered when attachment feature is implemented. */
export interface AttachmentBlock {
  type: 'attachment';
  id: string;
  attachment: MessageAttachment;
}
