/**
 * Memory and context file types for hermes-agent.
 */

/** Memory file entry. */
export interface MemoryFile {
  path: string;
  content: string;
  modified_at: string;
  size_bytes: number;
}

/** Context file for prompt injection. */
export interface ContextFile {
  path: string;
  content: string;
  encoding?: string;
  size_bytes?: number;
  last_modified?: string;
}

/** Memory entry in MEMORY.md format. */
export interface MemoryEntry {
  id: string;
  content: string;
  created_at: string;
  updated_at: string;
  tags?: string[];
  source?: string;
}

/** User profile entry. */
export interface UserProfile {
  id: string;
  name?: string;
  email?: string;
  metadata?: Record<string, unknown>;
}
