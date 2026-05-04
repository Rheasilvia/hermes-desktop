/**
 * Session types matching SessionDB schema.
 * @source hermes_state.py
 */

import type { Usage } from './message.js';

/** Session database row - mirrors sessions table. */
export interface SessionMeta {
  id: string;
  source: string;
  model: string;
  title: string | null;
  started_at: string;
  ended_at: string | null;
  message_count: number;
  tool_call_count: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  reasoning_tokens: number;
  billing_provider: string | null;
  billing_base_url: string | null;
  billing_mode: string | null;
  estimated_cost_usd: number | null;
  actual_cost_usd: number | null;
  cost_status: string | null;
  cost_source: string | null;
  pricing_version: string | null;
  user_id: string | null;
  model_config: string | null;
  system_prompt: string | null;
  parent_session_id: string | null;
  end_reason: string | null;
}

/** Message database row - mirrors messages table. */
export interface SessionMessage {
  session_id: string;
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_call_id: string | null;
  tool_calls: unknown | null;
  tool_name: string | null;
  timestamp: string;
  token_count: number;
  finish_reason: string | null;
  reasoning: string | null;
  reasoning_details: Record<string, unknown> | null;
  codex_reasoning_items: unknown | null;
}

/** Aggregated usage for a session. */
export interface SessionUsage {
  input: number;
  output: number;
  total: number;
  calls: number;
  cost_usd?: number;
  cache_read_tokens?: number;
  cache_write_tokens?: number;
  reasoning_tokens?: number;
}

/** Session info for UI display - matches SessionInfo from ui-tui. */
export interface SessionInfo {
  cwd?: string;
  mcp_servers?: McpServerStatus[];
  model: string;
  release_date?: string;
  skills: Record<string, string[]>;
  tools: Record<string, string[]>;
  update_behind?: number | null;
  update_command?: string;
  usage?: Usage;
  version?: string;
}

/** MCP server status in session info. */
export interface McpServerStatus {
  connected: boolean;
  name: string;
  tools: number;
  transport: string;
}

/** Session list item for picker. */
export interface SessionListItem {
  id: string;
  title: string;
  model: string;
  started_at: string;
  message_count: number;
  tool_call_count: number;
  last_message?: string;
}

/** @source hermes_state.py */
export interface Session {
  meta: SessionMeta;
  messages: SessionMessage[];
}
