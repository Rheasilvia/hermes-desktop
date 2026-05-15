/**
 * DB row types for session tables.
 * These map 1:1 to SQLite column names — never use in components.
 */

/** Mirrors state.db sessions table (read-only from desktop). */
export interface DbSession {
  id: string;
  source: string;
  model: string;
  title: string | null;
  started_at: number;
  ended_at: number | null;
  end_reason: string | null;
  message_count: number;
  tool_call_count: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  reasoning_tokens: number;
  billing_provider: string | null;
  estimated_cost_usd: number | null;
  actual_cost_usd: number | null;
  cost_status: string | null;
  parent_session_id: string | null;
}

/** Mirrors desktop.db session_desktop_meta table (desktop-owned). */
export interface DbDesktopSessionMeta {
  session_id: string;
  workspace_path: string | null;
  pinned: number;          // SQLite 0/1
  archived: number;        // SQLite 0/1
  last_opened_at: number | null;
  created_at: number;
}
