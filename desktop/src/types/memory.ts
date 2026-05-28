/**
 * Memory and context file types for hermes-agent.
 *
 * Field names mirror the Pydantic models in
 * `desktop_backend/schemas/memory.py`. The cross-language parity test
 * (`tests/unit/test_memory_schema_parity.py`) enforces both sides stay
 * in sync.
 */

/** Scope of a memory file: per-user (anchored at HERMES_HOME) or per-project (anchored at a workspace root). */
export type MemoryScope = 'user' | 'project';

/**
 * Fixed whitelist of memory file names. The backend rejects any other name
 * via Pydantic `Literal[...]` validation (HTTP 422), so the UI never has
 * cause to send something else.
 */
export type WellKnownMemoryName =
  | 'AGENTS.md'
  | 'CLAUDE.md'
  | '.hermes/context.md'
  | '.hermes/memories/MEMORY.md'
  | 'memories/MEMORY.md'
  | 'memories/USER.md';

/** File metadata returned by the memory list/read endpoints. */
export interface MemoryFile {
  scope: MemoryScope;
  workspace_path: string | null;
  well_known_name: WellKnownMemoryName;
  abs_path: string;
  exists: boolean;
  size_bytes: number;
  /** ISO 8601 UTC with microsecond precision; `null` when the file does not exist. */
  modified_at: string | null;
}

/** Memory file plus its content. Returned by GET /memory/file and PUT /memory/file. */
export interface MemoryFileWithContent extends MemoryFile {
  content: string;
}

/** A single hit from the memory search endpoint. */
export interface MemorySearchHit {
  info: MemoryFile;
  /** 1-based line number in the file. */
  line_number: number;
  snippet: string;
  match_count: number;
}

/** Project entry derived from the sessions table on the backend. */
export interface MemoryProject {
  workspace_path: string;
  /** ISO 8601 UTC. */
  last_used_at: string;
  session_count: number;
}

/**
 * Context file for prompt injection.
 *
 * Kept for backward compat with any caller that still imports the old shape.
 * Prefer {@link MemoryFile} for new code.
 */
export interface ContextFile {
  path: string;
  content: string;
  encoding?: string;
  size_bytes?: number;
  last_modified?: string;
}

/**
 * Structured memory entry (L3, deferred).
 *
 * Reserved for the next round when SQLite-backed entries with tag filtering
 * land. The L1+L2 manager does not produce or consume these.
 */
export interface MemoryEntry {
  id: string;
  content: string;
  created_at: string;
  updated_at: string;
  tags?: string[];
  source?: string;
}
