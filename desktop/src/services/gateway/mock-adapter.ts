/**
 * Mock gateway adapter with realistic data and simulated streaming.
 */

import type {
  GatewayAdapter,
  ConnectionState,
  GatewayEventMap,
  GatewayAdapterOptions,
  SessionListItem,
  SessionMessage,
  SessionMeta,
  SessionInfoPayload,
  HermesConfig,
  ToolEntry,
  ModelOption,
  CronJob,
  McpServer,
  McpTool,
  MemoryFile,
  ContextFile,
  MemoryEntry,
  ConfigSetInput,
  UpsertProviderInput,
  DeleteProviderInput,
  ModelOptionsResult,
  SkillInfo,
} from './types.js';
import type { ProviderEntry } from '@/types/index.js';

const DEFAULT_DELAY_MIN = 50;
const DEFAULT_DELAY_MAX = 150;

const delay = (min: number, max: number): Promise<void> =>
  new Promise(resolve =>
    setTimeout(resolve, min + Math.random() * (max - min))
  );

const generateId = (): string =>
  Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

const MOCK_TOOLS: ToolEntry[] = [
  {
    name: 'web_search',
    toolset: 'web',
    schema: {
      name: 'web_search',
      description: 'Search the web',
      parameters: {
        type: 'object',
        properties: {
          query: { name: 'query', type: 'string', description: 'Search query', required: true },
        },
      },
    },
    emoji: 'search',
  },
  {
    name: 'terminal',
    toolset: 'terminal',
    schema: {
      name: 'terminal',
      description: 'Run shell commands',
      parameters: {
        type: 'object',
        properties: {
          command: { name: 'command', type: 'string', description: 'Shell command', required: true },
        },
      },
    },
    emoji: 'terminal',
  },
  {
    name: 'file_read',
    toolset: 'filesystem',
    schema: {
      name: 'file_read',
      description: 'Read a file',
      parameters: {
        type: 'object',
        properties: {
          path: { name: 'path', type: 'string', description: 'File path', required: true },
        },
      },
    },
    emoji: 'file-text',
  },
];

const MOCK_MODELS: ModelOption[] = [
  {
    name: 'anthropic/claude-opus-4-5',
    display_name: 'Claude Opus 4.5',
    context_length: 200000,
    supports_vision: true,
    supports_function_calling: true,
    supports_streaming: true,
    default_temperature: 0.7,
    default_max_tokens: 8192,
    pricing_input: 0.015,
    pricing_output: 0.075,
    enabled: true,
  },
  {
    name: 'openrouter/openai/gpt-4o',
    display_name: 'GPT-4o',
    context_length: 128000,
    supports_vision: true,
    supports_function_calling: true,
    supports_streaming: true,
    default_temperature: 0.7,
    default_max_tokens: 16384,
    pricing_input: 0.005,
    pricing_output: 0.015,
    enabled: true,
  },
];

const MOCK_MCP_SERVERS: McpServer[] = [
  {
    name: 'filesystem',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
    transport: 'stdio',
  },
];

const MOCK_SESSIONS: SessionListItem[] = [
  {
    id: 'sess_verify_01',
    title: '[Design] 01 — Message Components',
    model: 'anthropic/claude-opus-4.5',
    started_at: new Date(Date.now() - 3600000 * 1).toISOString(),
    message_count: 8,
    tool_call_count: 0,
    last_message: 'async def handler(req): return await asyncio.wait_for(...)',
    workspace_path: '~/HermesWorkspace',
  },
  {
    id: 'sess_verify_02',
    title: '[Design] 02 — Tool Calls',
    model: 'anthropic/claude-opus-4.5',
    started_at: new Date(Date.now() - 3600000 * 2).toISOString(),
    message_count: 6,
    tool_call_count: 5,
    last_message: "I've reviewed the codebase. Here are the performance issues I found.",
    workspace_path: '~/HermesWorkspace',
  },
  {
    id: 'sess_abc123',
    title: 'Debugging Python async issues',
    model: 'anthropic/claude-opus-4.5',
    started_at: new Date(Date.now() - 3600000 * 2).toISOString(),
    message_count: 12,
    tool_call_count: 5,
    last_message: 'The issue was with the event loop not being properly awaited...',
    workspace_path: '~/HermesWorkspace',
  },
  {
    id: 'sess_def456',
    title: 'Planning new feature architecture',
    model: 'openrouter/openai/gpt-4o',
    started_at: new Date(Date.now() - 3600000 * 24).toISOString(),
    message_count: 28,
    tool_call_count: 14,
    last_message: 'We should use the adapter pattern for the new module...',
    workspace_path: '/home/dev/hermes',
  },
  {
    id: 'sess_ghi789',
    title: 'Reviewing pull requests',
    model: 'anthropic/claude-opus-4.5',
    started_at: new Date(Date.now() - 3600000 * 48).toISOString(),
    message_count: 7,
    tool_call_count: 2,
    last_message: 'LGTM! Just a few nits about naming conventions.',
    workspace_path: null,
  },
];

// Dynamically created sessions (not in static MOCK_SESSIONS)
const dynamicSessions: SessionListItem[] = [];

function createMockSessionMeta(id: string, model: string, workspace_path?: string | null): SessionMeta {
  return {
    id,
    source: 'mock',
    model,
    title: MOCK_SESSIONS.find(s => s.id === id)?.title ?? 'Mock Session',
    started_at: new Date(Date.now() - 3600000).toISOString(),
    ended_at: null,
    message_count: Math.floor(Math.random() * 20) + 5,
    tool_call_count: Math.floor(Math.random() * 10),
    input_tokens: Math.floor(Math.random() * 5000) + 500,
    output_tokens: Math.floor(Math.random() * 10000) + 1000,
    cache_read_tokens: Math.floor(Math.random() * 2000),
    cache_write_tokens: Math.floor(Math.random() * 500),
    reasoning_tokens: Math.floor(Math.random() * 3000),
    billing_provider: 'mock',
    billing_base_url: null,
    billing_mode: 'auto',
    estimated_cost_usd: Math.random() * 0.5,
    actual_cost_usd: null,
    cost_status: null,
    cost_source: null,
    pricing_version: null,
    user_id: null,
    model_config: null,
    system_prompt: null,
    parent_session_id: null,
    end_reason: null,
    workspace_path: workspace_path ?? null,
  };
}

// ─── Design Verification: 02 — Tool Calls ────────────────────────────────────
// Exercises: Tool Calls Collapsed (initial), Expanded (click "Details ▾"), Streaming (send a message).
// The 5 tool calls match the design spec exactly: read_file×3, search_code×1, web_search×1.
function createSection02Messages(sessionId: string): SessionMessage[] {
  const t = (offsetMs: number) => new Date(Date.now() - offsetMs).toISOString();
  return [
    {
      session_id: sessionId,
      role: 'user',
      content: 'Review my async handler and fix any performance issues.',
      tool_call_id: null, tool_calls: null, tool_name: null,
      timestamp: t(600000), token_count: 10, finish_reason: 'stop',
      reasoning: null, reasoning_details: null, codex_reasoning_items: null,
    },
    {
      session_id: sessionId,
      role: 'assistant',
      content: `I've reviewed the codebase. Here are the performance issues I found:\n\n- \`handle_request\` in \`src/handler.py\` lacks a timeout guard — wraps an unbounded coroutine\n- \`src/utils.py\` calls \`asyncio.sleep(0)\` in a tight loop, which yields unnecessarily\n- Tests in \`tests/test_handler.py\` mock the event loop, masking real latency\n\nRecommendation: wrap the handler with \`asyncio.wait_for(coro, timeout=30)\` and remove the busy-yield in utils.`,
      tool_call_id: null,
      tool_calls: [
        { id: 'tc_01', function: { name: 'read_file',   arguments: '{"path":"src/handler.py"}' } },
        { id: 'tc_02', function: { name: 'search_code', arguments: '{"query":"handle_request"}' } },
        { id: 'tc_03', function: { name: 'read_file',   arguments: '{"path":"src/utils.py"}' } },
        { id: 'tc_04', function: { name: 'read_file',   arguments: '{"path":"tests/test_handler.py"}' } },
        { id: 'tc_05', function: { name: 'web_search',  arguments: '{"query":"aiohttp install python"}' } },
      ],
      tool_name: null,
      timestamp: t(590000), token_count: 120, finish_reason: 'stop',
      reasoning: null, reasoning_details: null, codex_reasoning_items: null,
    },
    // Second exchange: error + complete statuses
    {
      session_id: sessionId,
      role: 'user',
      content: 'Can you also check the secrets config?',
      tool_call_id: null, tool_calls: null, tool_name: null,
      timestamp: t(300000), token_count: 10, finish_reason: 'stop',
      reasoning: null, reasoning_details: null, codex_reasoning_items: null,
    },
    {
      session_id: sessionId,
      role: 'assistant',
      content: 'I found one accessible config file. The secrets file was permission-denied.',
      tool_call_id: null,
      tool_calls: [
        { id: 'tc_06', status: 'error',    function: { name: 'read_file', arguments: '{"path":"config/secrets.py"}' } },
        { id: 'tc_07', status: 'complete', function: { name: 'read_file', arguments: '{"path":"config/settings.py"}' } },
      ],
      tool_name: null,
      timestamp: t(290000), token_count: 30, finish_reason: 'stop',
      reasoning: null, reasoning_details: null, codex_reasoning_items: null,
    },
    // Third exchange: running status (snapshot mid-execution)
    {
      session_id: sessionId,
      role: 'user',
      content: 'Now check all the test files.',
      tool_call_id: null, tool_calls: null, tool_name: null,
      timestamp: t(120000), token_count: 8, finish_reason: 'stop',
      reasoning: null, reasoning_details: null, codex_reasoning_items: null,
    },
    {
      session_id: sessionId,
      role: 'assistant',
      content: null,
      tool_call_id: null,
      tool_calls: [
        { id: 'tc_08', status: 'complete', function: { name: 'read_file',   arguments: '{"path":"tests/test_api.py"}' } },
        { id: 'tc_09', status: 'running',  function: { name: 'read_file',   arguments: '{"path":"tests/test_models.py"}' } },
        { id: 'tc_10', status: 'running',  function: { name: 'search_code', arguments: '{"query":"assert"}' } },
      ],
      tool_name: null,
      timestamp: t(110000), token_count: 0, finish_reason: 'tool_use',
      reasoning: null, reasoning_details: null, codex_reasoning_items: null,
    },
  ];
}

// ─── Design Verification: 01 — Message Components ───────────────────────────
// Exercises: User bubble, AI plain text, AI markdown (h2+bullets+callout), AI code block.
function createSection01Messages(sessionId: string): SessionMessage[] {
  const t = (offsetMs: number) => new Date(Date.now() - offsetMs).toISOString();
  return [
    // 1. User Message — dark bubble, right-aligned, [12,12,2,12] corners
    {
      session_id: sessionId,
      role: 'user',
      content: 'How do I fix this async bug?',
      tool_call_id: null, tool_calls: null, tool_name: null,
      timestamp: t(500000), token_count: 14, finish_reason: 'stop',
      reasoning: null, reasoning_details: null, codex_reasoning_items: null,
    },
    {
      session_id: sessionId,
      role: 'user',
      content: 'It throws TimeoutError on line 42.',
      tool_call_id: null, tool_calls: null, tool_name: null,
      timestamp: t(490000), token_count: 11, finish_reason: 'stop',
      reasoning: null, reasoning_details: null, codex_reasoning_items: null,
    },
    // 2. AI Text Message — avatar row (H, Hermes, timestamp) + plain prose
    {
      session_id: sessionId,
      role: 'assistant',
      content: 'Let me check the handler file to understand the context. The TimeoutError likely comes from the coroutine not having a proper deadline set.',
      tool_call_id: null, tool_calls: null, tool_name: null,
      timestamp: t(480000), token_count: 38, finish_reason: 'stop',
      reasoning: null, reasoning_details: null, codex_reasoning_items: null,
    },
    // 3. User follow-up
    {
      session_id: sessionId,
      role: 'user',
      content: 'What exactly is the root cause?',
      tool_call_id: null, tool_calls: null, tool_name: null,
      timestamp: t(460000), token_count: 8, finish_reason: 'stop',
      reasoning: null, reasoning_details: null, codex_reasoning_items: null,
    },
    // 3. AI Markdown — h2 heading + bullets + inline callout hint
    {
      session_id: sessionId,
      role: 'assistant',
      content: `## Root Cause Analysis

- The coroutine lacks an explicit timeout guard
- \`asyncio.wait_for()\` is not wrapping the handler
- Default timeout resolves to \`None\` (unlimited)

> **Fix:** \`asyncio.wait_for(coro, timeout=30)\``,
      tool_call_id: null, tool_calls: null, tool_name: null,
      timestamp: t(440000), token_count: 72, finish_reason: 'stop',
      reasoning: null, reasoning_details: null, codex_reasoning_items: null,
    },
    // 4. User asks for code
    {
      session_id: sessionId,
      role: 'user',
      content: 'Can you show me the corrected handler?',
      tool_call_id: null, tool_calls: null, tool_name: null,
      timestamp: t(420000), token_count: 9, finish_reason: 'stop',
      reasoning: null, reasoning_details: null, codex_reasoning_items: null,
    },
    // 4. AI Code Block — dark bg #30302e, language label, Copy button, mono font
    {
      session_id: sessionId,
      role: 'assistant',
      content: `Here is the corrected implementation:

\`\`\`python
async def handler(req):
    return await asyncio.wait_for(
        process(req), timeout=30
    )
\`\`\``,
      tool_call_id: null, tool_calls: null, tool_name: null,
      timestamp: t(400000), token_count: 55, finish_reason: 'stop',
      reasoning: null, reasoning_details: null, codex_reasoning_items: null,
    },
  ];
}

function createMockSessionMessages(sessionId: string): SessionMessage[] {
  if (sessionId === 'sess_verify_02') return createSection02Messages(sessionId);
  if (sessionId === 'sess_verify_01') return createSection01Messages(sessionId);
  return [
    {
      session_id: sessionId,
      role: 'user',
      content: 'Can you help me understand how the gateway adapter works?',
      tool_call_id: null,
      tool_calls: null,
      tool_name: null,
      timestamp: new Date(Date.now() - 300000).toISOString(),
      token_count: 150,
      finish_reason: 'stop',
      reasoning: null,
      reasoning_details: null,
      codex_reasoning_items: null,
    },
    {
      session_id: sessionId,
      role: 'assistant',
      content:
        'The gateway adapter provides an abstraction layer between the UI and the Hermes gateway process. It exposes typed methods for all JSON-RPC operations and emits events for streaming responses.',
      tool_call_id: null,
      tool_calls: null,
      tool_name: null,
      timestamp: new Date(Date.now() - 250000).toISOString(),
      token_count: 420,
      finish_reason: 'stop',
      reasoning: 'The user is asking about the gateway adapter architecture. I should explain the adapter pattern used here.',
      reasoning_details: null,
      codex_reasoning_items: null,
    },
  ];
}

const MOCK_CONFIG: HermesConfig = {
  model: {
    provider: 'anthropic',
    model: 'claude-opus-4.5',
  },
  providers: {
    anthropic: {
      provider: 'anthropic',
      base_url: 'https://api.anthropic.com',
      api_key: '***',
      timeout: 60,
      max_retries: 3,
    },
    openrouter: {
      provider: 'openrouter',
      base_url: 'https://openrouter.ai/api/v1',
      api_key: '***',
      timeout: 60,
      max_retries: 3,
    },
  },
  fallback_providers: ['openrouter'],
  toolsets: {
    enabled: ['web', 'terminal', 'filesystem', 'code_execution'],
    disabled: [],
  },
  agent: {
    max_iterations: 90,
    save_trajectories: false,
    system_prompt: undefined,
  },
  display: {
    theme: 'dark',
    skin: 'default',
    show_cost: true,
    show_reasoning: true,
    tool_progress_command: 'default',
    background_process_notifications: 'all',
  },
  memory: {
    enabled: true,
    max_entries: 1000,
  },
  cron: {
    enabled: true,
    max_jobs: 20,
  },
  security: {
    approval_required: true,
    dangerous_commands: ['rm', 'dd', 'mkfs'],
  },
  _config_version: 5,
};

const MOCK_CRON_JOBS: CronJob[] = [
  {
    id: 'cron_abc',
    name: 'Daily standup report',
    prompt: 'Generate a summary of all completed tasks and send it to me.',
    skills: [],
    skill: null,
    model: null,
    provider: null,
    base_url: null,
    api_key: null,
    script: null,
    schedule: {
      kind: 'cron',
      expr: '0 9 * * *',
      display: 'Every day at 09:00',
    },
    schedule_display: 'Every day at 09:00',
    repeat: { times: null, completed: 0 },
    enabled: true,
    state: 'scheduled',
    paused_at: null,
    paused_reason: null,
    created_at: new Date(Date.now() - 86400000 * 7).toISOString(),
    next_run_at: new Date(Date.now() + 86400000).toISOString(),
    last_run_at: null,
    last_status: null,
    last_error: null,
    last_delivery_error: null,
    deliver: 'origin',
    origin: null,
  },
];

const MOCK_MEMORY_FILES: MemoryFile[] = [
  {
    path: '~/.hermes/memory/MEMORY.md',
    content: '# Memory\n\n- Project uses TypeScript + SolidJS for the desktop app',
    modified_at: new Date(Date.now() - 3600000).toISOString(),
    size_bytes: 128,
  },
];

const MOCK_CONTEXT_FILES: ContextFile[] = [
  {
    path: '/home/user/project/AGENTS.md',
    content: '# Project Agent Instructions\n\nThis project uses the gateway adapter pattern.',
    encoding: 'utf-8',
    size_bytes: 256,
    last_modified: new Date().toISOString(),
  },
];

const MOCK_MEMORY_ENTRIES: MemoryEntry[] = [
  {
    id: 'mem_abc',
    content: 'User prefers detailed explanations over brief answers.',
    created_at: new Date(Date.now() - 86400000).toISOString(),
    updated_at: new Date(Date.now() - 3600000).toISOString(),
    tags: ['user-preference'],
    source: 'context',
  },
];

const MOCK_SKILL_INFOS: SkillInfo[] = [
  { name: 'code-review', description: 'Perform a thorough code review of any diff or PR.', category: 'Development', enabled: true },
  { name: 'refactor', description: 'Suggest and apply refactoring improvements to code.', category: 'Development', enabled: true },
  { name: 'debug', description: 'Help debug issues with detailed root-cause analysis.', category: 'Development', enabled: true },
  { name: 'deep-research', description: 'Multi-source research with citation and synthesis.', category: 'Research', enabled: true },
  { name: 'web-summarize', description: 'Fetch and summarize web pages or articles.', category: 'Research', enabled: false },
  { name: 'doc-writer', description: 'Generate documentation from code and comments.', category: 'Productivity', enabled: true },
  { name: 'task-planner', description: 'Break down complex tasks into actionable steps.', category: 'Productivity', enabled: false },
  { name: 'shell-expert', description: 'Advanced shell command generation and explanation.', category: 'System', enabled: true },
  { name: 'git-wizard', description: 'Smart Git operations: rebase, conflict resolution, history.', category: 'System', enabled: true },
  { name: 'email-assistant', description: 'Draft and manage emails with tone analysis.', category: 'Communication', enabled: false },
];


function streamText(
  text: string,
  onDelta: (delta: string) => void,
  delayMin: number,
  delayMax: number
): () => void {
  let index = 0;
  let cancelled = false;

  const tick = (): void => {
    if (cancelled || index >= text.length) return;
    const chunk = text[index];
    index++;
    onDelta(chunk);
    const pause = delayMin + Math.random() * (delayMax - delayMin);
    setTimeout(tick, pause);
  };

  tick();

  return () => {
    cancelled = true;
  };
}

type EventHandler<K extends keyof GatewayEventMap> = (payload: GatewayEventMap[K]) => void;

export class MockGatewayAdapter implements GatewayAdapter {
  readonly session: GatewayAdapter['session'];
  readonly prompt: GatewayAdapter['prompt'];
  readonly config: GatewayAdapter['config'];
  readonly tools: GatewayAdapter['tools'];
  readonly model: GatewayAdapter['model'];
  readonly provider: GatewayAdapter['provider'];
  readonly approval: GatewayAdapter['approval'];
  readonly clarify: GatewayAdapter['clarify'];
  readonly sudo: GatewayAdapter['sudo'];
  readonly secret: GatewayAdapter['secret'];
  readonly cron: GatewayAdapter['cron'];
  readonly mcp: GatewayAdapter['mcp'];
  readonly memory: GatewayAdapter['memory'];
  readonly skills: GatewayAdapter['skills'];
  readonly complete: GatewayAdapter['complete'];
  readonly slash: GatewayAdapter['slash'];
  readonly command: GatewayAdapter['command'];

  private state: ConnectionState = 'disconnected';
  private handlers: Map<string, Set<EventHandler<keyof GatewayEventMap>>> = new Map();
  private activeStreams: (() => void)[] = [];
  private delayMin: number;
  private delayMax: number;
  private mockProviders: ProviderEntry[] = [];
  private mockActiveProvider = 'openai';
  private mockActiveModel = 'gpt-4o';
  private mockConfigMtime = Math.floor(Date.now() / 1000);

  constructor(options: GatewayAdapterOptions = {}) {
    this.delayMin = options.delayMin ?? DEFAULT_DELAY_MIN;
    this.delayMax = options.delayMax ?? DEFAULT_DELAY_MAX;

    this.session = {
      list: async (): Promise<SessionListItem[]> => {
        await delay(this.delayMin, this.delayMax);
        return [...MOCK_SESSIONS, ...dynamicSessions];
      },
      info: async (sessionId: string): Promise<SessionInfoPayload> => {
        await delay(this.delayMin, this.delayMax);
        const sess = MOCK_SESSIONS.find(s => s.id === sessionId);
        if (!sess) throw new Error(`Session not found: ${sessionId}`);
        return {
          model: sess.model,
          skills: {},
          tools: { web: ['web_search'], terminal: ['terminal'] },
          usage: {
            calls: sess.message_count,
            input: 5000,
            output: 12000,
            total: 17000,
            cost_usd: 0.12,
          },
        };
      },
      create: async (params): Promise<SessionMeta> => {
        await delay(this.delayMin, this.delayMax);
        const id = `sess_${generateId()}`;
        const meta = createMockSessionMeta(id, params.model ?? 'anthropic/claude-opus-4.5', params.workspace_path);
        dynamicSessions.push({
          id,
          title: meta.title ?? 'New Session',
          model: meta.model,
          started_at: meta.started_at,
          message_count: 0,
          tool_call_count: 0,
          workspace_path: meta.workspace_path,
        });
        return meta;
      },
      delete: async (sessionId: string): Promise<void> => {
        await delay(this.delayMin, this.delayMax);
        const idx = MOCK_SESSIONS.findIndex(s => s.id === sessionId);
        if (idx === -1) throw new Error(`Session not found: ${sessionId}`);
      },
      branch: async (sessionId: string): Promise<SessionMeta> => {
        await delay(this.delayMin, this.delayMax);
        const newId = `sess_${generateId()}`;
        return { ...createMockSessionMeta(sessionId, 'anthropic/claude-opus-4.5'), id: newId, parent_session_id: sessionId };
      },
      resume: async (_sessionId): Promise<void> => {
        await delay(this.delayMin, this.delayMax);
      },
      interrupt: async (): Promise<void> => {
        await delay(10, 30);
        this.activeStreams.forEach(stop => stop());
        this.activeStreams = [];
      },
      messages: async (sessionId: string): Promise<SessionMessage[]> => {
        await delay(this.delayMin, this.delayMax);
        return createMockSessionMessages(sessionId);
      },
    };

    this.prompt = {
      execute: async (params): Promise<void> => {
        await delay(this.delayMin, this.delayMax);
        const sessionId = params.session_id ?? MOCK_SESSIONS[0].id;

        this.emit('message.start', { message_id: generateId() });

        // ── Section 02 streaming simulation ──────────────────────────────────
        // Demonstrates all 3 tool statuses: complete (✓), error (✗), running (●).
        if (sessionId === 'sess_verify_02') {
          type MockTool =
            | { id: string; name: string; kind: 'complete'; summary: string; duration_s: number }
            | { id: string; name: string; kind: 'error'; error: string; duration_s: number }
            | { id: string; name: string; kind: 'running'; pauseMs: number };

          const tools: MockTool[] = [
            { id: 'ltc_01', name: 'read_file',   kind: 'complete', summary: '247 lines', duration_s: 0.2 },
            { id: 'ltc_02', name: 'search_code', kind: 'complete', summary: '3 matches',  duration_s: 0.21 },
            { id: 'ltc_03', name: 'read_file',   kind: 'error',    error: 'Permission denied: /src/secrets.py', duration_s: 0.1 },
            { id: 'ltc_04', name: 'web_search',  kind: 'running',  pauseMs: 3000 },
          ];

          for (const tc of tools) {
            this.emit('tool.start', { tool_id: tc.id, name: tc.name });
            if (tc.kind === 'complete') {
              await delay(200, 300);
              this.emit('tool.complete', { tool_id: tc.id, name: tc.name, summary: tc.summary, duration_s: tc.duration_s });
            } else if (tc.kind === 'error') {
              await delay(150, 200);
              this.emit('tool.error', { tool_id: tc.id, name: tc.name, error: tc.error, duration_s: tc.duration_s });
            } else {
              // running — pause to make the running state visible, then complete
              await delay(tc.pauseMs, tc.pauseMs + 200);
              this.emit('tool.complete', { tool_id: tc.id, name: tc.name, summary: '5 results', duration_s: 0.9 });
            }
          }
        }
        // ─────────────────────────────────────────────────────────────────────

        const responseText =
          "I'm currently running in mock mode. In a real session, I'd be processing your message through the Hermes agent with full tool-calling capabilities. The gateway adapter pattern lets the UI stay clean while delegating to the Python backend.";

        const stop = streamText(responseText, delta => {
          this.emit('message.delta', { text: delta });
        }, this.delayMin, this.delayMax);

        this.activeStreams.push(stop);

        await delay(responseText.length * (this.delayMin + this.delayMax) / 2 + 200, responseText.length * (this.delayMin + this.delayMax) / 2 + 400);

        stop();
        this.activeStreams = this.activeStreams.filter(s => s !== stop);

        this.emit('message.complete', {
          text: responseText,
          rendered: false,
          usage: {
            calls: 1,
            input: 150,
            output: responseText.length,
            total: 150 + responseText.length,
            cost_usd: 0.001,
          },
          status: {
            cost_usd: 0.001,
            cache_read_tokens: 0,
            cache_write_tokens: 0,
            reasoning_tokens: 80,
          },
        });
      },
    };

    this.config = {
      get: async (): Promise<HermesConfig> => {
        await delay(this.delayMin, this.delayMax);
        return { ...MOCK_CONFIG };
      },
      getMtime: async (): Promise<number> => {
        await delay(this.delayMin / 2, this.delayMax / 2);
        return this.mockConfigMtime;
      },
      set: async (input: ConfigSetInput): Promise<void> => {
        await delay(this.delayMin, this.delayMax);
        if (input.key === 'model' && typeof input.value === 'string') {
          const [provider, ...rest] = input.value.split('/');
          this.mockActiveProvider = provider;
          this.mockActiveModel = rest.join('/');
        }
        this.mockConfigMtime = Date.now() / 1000;
      },
    };

    this.tools = {
      list: async (): Promise<ToolEntry[]> => {
        await delay(this.delayMin, this.delayMax);
        return [...MOCK_TOOLS];
      },
      reload: async (): Promise<void> => {
        await delay(this.delayMin, this.delayMax);
      },
    };

    this.model = {
      options: async (_sessionId?: string): Promise<ModelOptionsResult> => {
        await delay(this.delayMin, this.delayMax);
        return {
          providers: this.mockProviders,
          model: this.mockActiveModel,
          provider: this.mockActiveProvider,
        };
      },
    };

    this.provider = {
      upsert: async (input: UpsertProviderInput): Promise<{ name: string }> => {
        await delay(this.delayMin, this.delayMax);
        const idx = this.mockProviders.findIndex(p => p.name === input.name);
        const merged: ProviderEntry = {
          name: input.name,
          display_name: input.display_name ?? input.name,
          base_url: input.base_url,
          api_key: input.api_key,
          api_key_env: input.api_key_env,
          is_builtin: input.is_builtin,
          models: idx >= 0 ? this.mockProviders[idx].models : [],
        };
        if (idx >= 0) this.mockProviders[idx] = { ...this.mockProviders[idx], ...merged };
        else this.mockProviders.push(merged);
        this.mockConfigMtime = Date.now() / 1000;
        return { name: input.name };
      },
      delete: async (input: DeleteProviderInput): Promise<{ ok: boolean }> => {
        await delay(this.delayMin, this.delayMax);
        this.mockProviders = this.mockProviders.filter(p => p.name !== input.name);
        this.mockConfigMtime = Date.now() / 1000;
        return { ok: true };
      },
    };

    this.approval = {
      respond: async (_params): Promise<void> => {
        await delay(this.delayMin, this.delayMax);
      },
    };

    this.clarify = {
      respond: async (_params): Promise<void> => {
        await delay(this.delayMin, this.delayMax);
      },
    };

    this.sudo = {
      respond: async (_params): Promise<void> => {
        await delay(this.delayMin, this.delayMax);
      },
    };

    this.secret = {
      respond: async (_params): Promise<void> => {
        await delay(this.delayMin, this.delayMax);
      },
    };

    this.cron = {
      list: async (): Promise<CronJob[]> => {
        await delay(this.delayMin, this.delayMax);
        return [...MOCK_CRON_JOBS];
      },
      create: async (job): Promise<CronJob> => {
        await delay(this.delayMin, this.delayMax);
        return {
          id: `cron_${generateId()}`,
          name: job.name ?? 'New Cron Job',
          prompt: job.prompt,
          skills: job.skills ?? [],
          skill: job.skill ?? null,
          model: job.model ?? null,
          provider: job.provider ?? null,
          base_url: job.base_url ?? null,
          api_key: null,
          script: job.script ?? null,
          schedule: { kind: 'once' as const, display: job.schedule },
          schedule_display: job.schedule as string,
          repeat: { times: job.repeat ?? null, completed: 0 },
          enabled: true,
          state: 'scheduled',
          paused_at: null,
          paused_reason: null,
          created_at: new Date().toISOString(),
          next_run_at: null,
          last_run_at: null,
          last_status: null,
          last_error: null,
          last_delivery_error: null,
          deliver: job.deliver ?? 'origin',
          origin: job.origin ?? null,
        };
      },
      update: async (id, job): Promise<CronJob> => {
        await delay(this.delayMin, this.delayMax);
        const existing = MOCK_CRON_JOBS.find(c => c.id === id);
        if (!existing) throw new Error(`Cron job not found: ${id}`);
        const { skills: _skills, schedule: _schedule, repeat: _repeat, deliver: _deliver, ...rest } = job;
        return {
          ...existing,
          ...rest,
          skills: job.skills ?? existing.skills,
          schedule: job.schedule
            ? { kind: 'cron' as const, display: job.schedule }
            : existing.schedule,
          repeat: job.repeat != null
            ? { times: typeof job.repeat === 'number' ? job.repeat : null, completed: existing.repeat.completed }
            : existing.repeat,
          deliver: (job.deliver ?? existing.deliver) as CronJob['deliver'],
        };
      },
      delete: async (id): Promise<void> => {
        await delay(this.delayMin, this.delayMax);
        if (!MOCK_CRON_JOBS.find(c => c.id === id)) {
          throw new Error(`Cron job not found: ${id}`);
        }
      },
    };

    this.mcp = {
      list: async (): Promise<McpServer[]> => {
        await delay(this.delayMin, this.delayMax);
        return [...MOCK_MCP_SERVERS];
      },
      add: async (server): Promise<McpServer> => {
        await delay(this.delayMin, this.delayMax);
        return {
          name: server.name ?? `server_${generateId()}`,
          command: server.command,
          args: server.args,
          env: server.env,
          transport: server.transport ?? 'stdio',
        };
      },
      remove: async (name): Promise<void> => {
        await delay(this.delayMin, this.delayMax);
        if (!MOCK_MCP_SERVERS.find(s => s.name === name)) {
          throw new Error(`MCP server not found: ${name}`);
        }
      },
      tools: async (_serverName): Promise<McpTool[]> => {
        await delay(this.delayMin, this.delayMax);
        return [
          { name: 'read_directory', description: 'List directory contents', inputSchema: { type: 'object' } },
        ];
      },
    };

    this.memory = {
      files: async (): Promise<MemoryFile[]> => {
        await delay(this.delayMin, this.delayMax);
        return [...MOCK_MEMORY_FILES];
      },
      contextFiles: async (): Promise<ContextFile[]> => {
        await delay(this.delayMin, this.delayMax);
        return [...MOCK_CONTEXT_FILES];
      },
      search: async (query): Promise<MemoryEntry[]> => {
        await delay(this.delayMin, this.delayMax);
        return MOCK_MEMORY_ENTRIES.filter(e =>
          e.content.toLowerCase().includes(query.toLowerCase())
        );
      },
    };

    this.skills = {
      list: async (): Promise<SkillInfo[]> => {
        await delay(this.delayMin, this.delayMax);
        return [...MOCK_SKILL_INFOS];
      },
    };

    this.complete = {
      slash: async (params: { partial: string }): Promise<{ command: string; description: string }[]> => {
        await delay(this.delayMin / 2, this.delayMax / 2);
        return MOCK_SKILL_INFOS.filter(s => s.name.startsWith(params.partial))
          .map(s => ({ command: s.name, description: s.description }));
      },
      path: async (params: { partial: string }): Promise<string[]> => {
        await delay(this.delayMin / 2, this.delayMax / 2);
        return ['/home/user/project/src/', '/home/user/project/tests/'];
      },
    };

    this.slash = {
      exec: async (_params): Promise<void> => {
        await delay(this.delayMin, this.delayMax);
      },
    };

    this.command = {
      dispatch: async (_params): Promise<void> => {
        await delay(this.delayMin, this.delayMax);
      },
    };

    if (typeof window !== 'undefined') {
      (window as unknown as { __HERMES_MOCK: unknown }).__HERMES_MOCK = {
        setApiKey: (name: string, key: string) => {
          const p = this.mockProviders.find(pr => pr.name === name);
          if (p) {
            p.api_key = key;
            this.mockConfigMtime = Math.floor(Date.now() / 1000) + 10;
          }
        },
      };
    }
  }

  private emit<K extends keyof GatewayEventMap>(event: K, payload: GatewayEventMap[K]): void {
    const handlers = this.handlers.get(event);
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(payload);
        } catch {
          // swallow
        }
      }
    }
  }

  on<K extends keyof GatewayEventMap>(event: K, handler: EventHandler<K>): void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event)!.add(handler as EventHandler<keyof GatewayEventMap>);
  }

  off<K extends keyof GatewayEventMap>(event: K, handler: EventHandler<K>): void {
    const handlers = this.handlers.get(event);
    if (handlers) {
      handlers.delete(handler as EventHandler<keyof GatewayEventMap>);
    }
  }

  async connect(): Promise<void> {
    this.state = 'connecting';
    await delay(100, 300);
    this.state = 'connected';
    this.emit('gateway.ready', { skin: undefined });
    this.emit('session.info', {
      model: 'anthropic/claude-opus-4.5',
      skills: { 'code-review': ['code-review'], refactor: ['refactor'] },
      tools: { web: ['web_search'], terminal: ['terminal'] },
      usage: { calls: 42, input: 50000, output: 120000, total: 170000, cost_usd: 1.23 },
    });
  }

  async disconnect(): Promise<void> {
    this.activeStreams.forEach(stop => stop());
    this.activeStreams = [];
    this.handlers.clear();
    this.state = 'disconnected';
  }

  getConnectionState(): ConnectionState {
    return this.state;
  }
}
