import type {
  ToolEntry,
  ModelOption,
  McpServer,
  SkillInfo,
  SessionListItem,
  SessionMessage,
  HermesConfig,
  CronJob,
  MemoryFile,
  ContextFile,
  MemoryEntry,
} from '../types.js';

import rawTools from './tools.json';
import rawModels from './models.json';
import rawMcpServers from './mcp-servers.json';
import rawSkills from './skills.json';
import rawSessions from './sessions.json';
import rawSessionMessages from './session-messages.json';
import rawConfig from './config.json';
import rawCronJobs from './cron-jobs.json';
import rawMemoryFiles from './memory-files.json';
import rawContextFiles from './context-files.json';
import rawMemoryEntries from './memory-entries.json';

/** Positive offsetMs = past, negative = future */
const ts = (offsetMs: number): string => new Date(Date.now() - offsetMs).toISOString();

export const MOCK_TOOLS: ToolEntry[] = rawTools as unknown as ToolEntry[];
export const MOCK_MODELS: ModelOption[] = rawModels as unknown as ModelOption[];
export const MOCK_MCP_SERVERS: McpServer[] = rawMcpServers as unknown as McpServer[];
export const MOCK_SKILL_INFOS: SkillInfo[] = rawSkills as unknown as SkillInfo[];

export const MOCK_CONFIG: HermesConfig = {
  ...(rawConfig as unknown as HermesConfig),
  agent: {
    ...rawConfig.agent,
    system_prompt: rawConfig.agent.system_prompt ?? undefined,
  },
};

export const MOCK_SESSIONS: SessionListItem[] = rawSessions.map(s => ({
  ...(s as Omit<SessionListItem, 'started_at'>),
  started_at: ts(s.started_at_offset_ms),
}));

export const MOCK_CRON_JOBS: CronJob[] = rawCronJobs.map(j => ({
  ...(j as Omit<CronJob, 'created_at' | 'next_run_at'>),
  created_at: ts(j.created_at_offset_ms),
  next_run_at: ts(j.next_run_at_offset_ms),
}));

export const MOCK_MEMORY_FILES: MemoryFile[] = rawMemoryFiles.map(f => ({
  ...(f as Omit<MemoryFile, 'modified_at'>),
  modified_at: ts(f.modified_at_offset_ms),
}));

export const MOCK_CONTEXT_FILES: ContextFile[] = rawContextFiles.map(f => ({
  ...(f as Omit<ContextFile, 'last_modified'>),
  last_modified: ts(f.last_modified_offset_ms),
}));

export const MOCK_MEMORY_ENTRIES: MemoryEntry[] = rawMemoryEntries.map(e => ({
  ...(e as Omit<MemoryEntry, 'created_at' | 'updated_at'>),
  created_at: ts(e.created_at_offset_ms),
  updated_at: ts(e.updated_at_offset_ms),
}));

type RawMessage = {
  session_id: string;
  role: string;
  content: string | null;
  tool_call_id: null;
  tool_calls: unknown[] | null;
  tool_name: null;
  timestamp_offset_ms: number;
  token_count: number;
  finish_reason: string;
  reasoning: string | null;
  reasoning_details: null;
  codex_reasoning_items: null;
};

function resolveMessages(msgs: RawMessage[], sessionId: string): SessionMessage[] {
  return msgs.map(m => ({
    ...(m as unknown as SessionMessage),
    session_id: m.session_id === '__SESSION_ID__' ? sessionId : m.session_id,
    timestamp: ts(m.timestamp_offset_ms),
  }));
}

const sessionMessageMap = rawSessionMessages as Record<string, RawMessage[]>;

export function createMockSessionMessages(sessionId: string): SessionMessage[] {
  const msgs = sessionMessageMap[sessionId] ?? sessionMessageMap['default'];
  return resolveMessages(msgs, sessionId);
}
