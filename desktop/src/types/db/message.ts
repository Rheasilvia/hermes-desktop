/**
 * DB row types for the messages table.
 * Maps 1:1 to state.db messages columns — never use in components.
 */

export interface DbMessage {
  id: number;
  session_id: string;
  role: 'user' | 'assistant' | 'tool' | 'system';
  content: string | null;
  tool_call_id: string | null;
  tool_calls: string | null;        // raw JSON string
  tool_name: string | null;
  timestamp: number;
  token_count: number | null;
  finish_reason: string | null;
  reasoning: string | null;
  reasoning_details: string | null; // raw JSON string
}
