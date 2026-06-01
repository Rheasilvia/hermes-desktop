/**
 * JSON-RPC gateway types matching tui_gateway/server.py.
 * @source tui_gateway/server.py
 */

import type { McpServerStatus } from './session.js';

/** JSON-RPC 2.0 request. */
export interface RpcRequest {
  jsonrpc: '2.0';
  id?: string | number;
  method: string;
  params?: Record<string, unknown>;
}

/** JSON-RPC 2.0 response. */
export interface RpcResponse {
  jsonrpc: '2.0';
  id?: string | number;
  result?: unknown;
  error?: RpcError;
}

/** JSON-RPC error. */
export interface RpcError {
  code: number;
  message: string;
  data?: unknown;
}

/** Standard result wrapper. */
export interface RpcResult {
  ok?: boolean;
  error?: string;
  result?: unknown;
}

/** Event emitted from gateway. */
export interface GatewayEvent {
  type: string;
  session_id?: string;
  payload?: unknown;
}

/** Session methods. */
export const SESSION_METHODS = {
  LIST: 'session.list',
  INFO: 'session.info',
  CREATE: 'session.create',
  DELETE: 'session.delete',
  BRANCH: 'session.branch',
  RESUME: 'session.resume',
  INTERRUPT: 'session.interrupt',
} as const;

/** Prompt methods. */
export const PROMPT_METHODS = {
  EXECUTE: 'prompt.execute',
} as const;

/** Config methods. */
export const CONFIG_METHODS = {
  GET: 'config.get',
  SET: 'config.set',
} as const;

/** Tools methods. */
export const TOOLS_METHODS = {
  LIST: 'tools.list',
  RELOAD: 'tools.reload',
} as const;

/** Model methods. */
export const MODEL_METHODS = {
  LIST: 'model.list',
  SET: 'model.set',
  GET: 'model.get',
} as const;

/** Approval methods. */
export const APPROVAL_METHODS = {
  RESPOND: 'approval.respond',
} as const;

/** Clarify methods. */
export const CLARIFY_METHODS = {
  RESPOND: 'clarify.respond',
} as const;

/** Sudo methods. */
export const SUDO_METHODS = {
  RESPOND: 'sudo.respond',
} as const;

/** Secret methods. */
export const SECRET_METHODS = {
  RESPOND: 'secret.respond',
} as const;

/** All known method names. */
export type GatewayMethod =
  | typeof SESSION_METHODS[keyof typeof SESSION_METHODS]
  | typeof PROMPT_METHODS[keyof typeof PROMPT_METHODS]
  | typeof CONFIG_METHODS[keyof typeof CONFIG_METHODS]
  | typeof TOOLS_METHODS[keyof typeof TOOLS_METHODS]
  | typeof MODEL_METHODS[keyof typeof MODEL_METHODS]
  | typeof APPROVAL_METHODS[keyof typeof APPROVAL_METHODS]
  | typeof CLARIFY_METHODS[keyof typeof CLARIFY_METHODS]
  | typeof SUDO_METHODS[keyof typeof SUDO_METHODS]
  | typeof SECRET_METHODS[keyof typeof SECRET_METHODS]
  | 'complete.slash'
  | 'complete.path'
  | 'slash.exec'
  | 'command.dispatch';

/** Gateway ready event payload. */
export interface GatewayReadyPayload {
  skin?: GatewaySkin;
}

/** Gateway skin/theme data. */
export interface GatewaySkin {
  colors?: {
    banner_border?: string;
    banner_title?: string;
    banner_accent?: string;
    banner_dim?: string;
    banner_text?: string;
    response_border?: string;
  };
  spinner?: {
    waiting_faces?: string[];
    thinking_faces?: string[];
    thinking_verbs?: string[];
    wings?: string[][];
  };
  branding?: {
    agent_name?: string;
    welcome?: string;
    goodbye?: string;
    response_label?: string;
    prompt_symbol?: string;
  };
  tool_prefix?: string;
  tool_emojis?: Record<string, string>;
}

/** Session info event payload. */
export interface SessionInfoPayload {
  cwd?: string;
  mcp_servers?: McpServerStatus[];
  model: string;
  release_date?: string;
  skills: Record<string, string[]>;
  tools: Record<string, string[]>;
  update_behind?: number | null;
  update_command?: string;
  usage?: SessionUsagePayload;
  version?: string;
}

/** Session usage payload. */
export interface SessionUsagePayload {
  calls: number;
  context_max?: number;
  context_percent?: number;
  context_used?: number;
  cost_usd?: number;
  input: number;
  output: number;
  total: number;
}

/** Message start event payload. */
export interface MessageStartPayload {
  message_id?: string;
}

/** Message delta event payload. */
export interface MessageDeltaPayload {
  text?: string;
  reasoning?: string;
  tool_calls?: unknown[];
  rendered?: boolean;
}

/** Message complete event payload. */
export interface MessageCompletePayload {
  text: string;
  rendered?: boolean;
  usage?: SessionUsagePayload;
  status?: MessageStatusPayload;
}

/** Message status payload. */
export interface MessageStatusPayload {
  cost_usd?: number;
  cache_read_tokens?: number;
  cache_write_tokens?: number;
  reasoning_tokens?: number;
}

/** Thinking delta event payload. */
export interface ThinkingDeltaPayload {
  text: string;
}

/** Reasoning delta event payload. */
export interface ReasoningDeltaPayload {
  text: string;
}

/** Reasoning available event payload. */
export interface ReasoningAvailablePayload {
  text: string;
}

/** Status update event payload. */
export interface StatusUpdatePayload {
  kind: string;
  text: string;
}

/** Tool start event payload. */
export interface ToolStartPayload {
  tool_id: string;
  name: string;
  context?: string;
}

/** Tool progress event payload. */
export interface ToolProgressPayload {
  name: string;
  preview?: string;
  progress?: string;
}

/** Todo item from tool execution. */
export interface TodoItem {
  id: string;
  content: string;
  status: 'cancelled' | 'completed' | 'in_progress' | 'pending';
}

/** Tool complete event payload. */
export interface ToolCompletePayload {
  tool_id: string;
  name: string;
  summary?: string;
  inline_diff?: string;
  duration_s?: number;
  todos?: TodoItem[];
}

/** Tool generating event payload. */
export interface ToolGeneratingPayload {
  tool_id: string;
  name: string;
  text: string;
}

/** Tool error event payload. */
export interface ToolErrorPayload {
  tool_id: string;
  name: string;
  error: string;
  duration_s?: number;
}

/** Approval request event payload. */
export interface ApprovalRequestPayload {
  command: string;
  description: string;
  path?: string;
  operation?: 'read' | 'write';
  is_path_approval?: boolean;
}

/** Clarify request event payload. */
export interface ClarifyRequestPayload {
  question: string;
  choices?: string[] | null;
  request_id: string;
}

/** Sudo request event payload. */
export interface SudoRequestPayload {
  request_id: string;
}

/** Secret request event payload. */
export interface SecretRequestPayload {
  prompt: string;
  env_var: string;
  request_id: string;
}

/** Background complete event payload. */
export interface BackgroundCompletePayload {
  task_id: string;
  text: string;
}

/** BTW complete event payload. */
export interface BtwCompletePayload {
  text: string;
}

/** Error event payload. */
export interface ErrorPayload {
  message: string;
  code?: number;
}

/** Gateway stderr event payload. */
export interface GatewayStderrPayload {
  text: string;
}

/** Protocol error event payload. */
export interface ProtocolErrorPayload {
  message: string;
}

/** Session title auto-update event payload (pushed via SSE after auto-title generation). */
export interface SessionTitleUpdatePayload {
  session_id: string;
  title: string;
}
