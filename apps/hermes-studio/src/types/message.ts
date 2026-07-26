/**
 * Message types matching hermes-agent OpenAI-compatible format.
 * @source run_agent.py
 */

/** @source run_agent.py */
export type Role = 'system' | 'user' | 'assistant' | 'tool';

/** @source run_agent.py */
export interface ToolCallFunction {
  name: string;
  arguments: string;
}

/** @source run_agent.py */
export interface ToolCall {
  id: string;
  type: 'function';
  function: ToolCallFunction;
}

/** Usage stats for API calls - mirrors SessionDB schema. */
export interface Usage {
  calls: number;
  context_max?: number;
  context_percent?: number;
  context_used?: number;
  cost_usd?: number;
  input: number;
  output: number;
  total: number;
}

/**
 * Full message with optional reasoning content.
 * @source run_agent.py (AIAgent class)
 */
export interface Message {
  role: Role;
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
  reasoning?: string;
  reasoning_details?: Record<string, unknown>;
  reasoning_items?: ReasoningItem[];
  /** @deprecated Use reasoning_items */
  codex_reasoning_items?: ReasoningItem[];
}

/** @source run_agent.py */
export interface ReasoningItem {
  type: 'thought' | 'plan' | 'critique' | 'reflection';
  content: string;
}

/** Delta update for streaming messages. */
export interface MessageDelta {
  text?: string;
  reasoning?: string;
  tool_calls?: ToolCall[];
  finish_reason?: string;
}

/** Completed message with final state. */
export interface MessageComplete {
  text: string;
  reasoning?: string;
  usage?: Usage;
  finish_reason?: string;
}

/** Status info for completed message. */
export interface MessageStatus {
  cost_usd?: number;
  cache_read_tokens?: number;
  cache_write_tokens?: number;
  reasoning_tokens?: number;
}
