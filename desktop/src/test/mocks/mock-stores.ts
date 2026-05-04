/**
 * Pre-populated mock stores for unit tests.
 * Provides ready-to-use store states without needing the full gateway.
 */

import type { SessionListItem, HermesConfig, ToolEntry, ModelOption, McpServer, CronJob } from '@/types/index.js';

/** Mock session list for tests */
export const MOCK_SESSIONS: SessionListItem[] = [
  {
    id: 'sess_test_1',
    title: 'Test Session 1',
    model: 'test/model-a',
    started_at: new Date(Date.now() - 3600000).toISOString(),
    message_count: 5,
    tool_call_count: 2,
    last_message: 'Hello from test session',
  },
  {
    id: 'sess_test_2',
    title: 'Test Session 2',
    model: 'test/model-b',
    started_at: new Date(Date.now() - 7200000).toISOString(),
    message_count: 10,
    tool_call_count: 5,
    last_message: 'Another test message',
  },
];

/** Mock config for tests */
export const MOCK_CONFIG: HermesConfig = {
  model: { provider: 'test', model: 'test-model' },
  providers: {
    test: { provider: 'test', base_url: 'https://test.example.com', api_key: '***', timeout: 60, max_retries: 3 },
  },
  fallback_providers: [],
  toolsets: { enabled: ['test'], disabled: [] },
  agent: { max_iterations: 90, save_trajectories: false, system_prompt: undefined },
  display: { theme: 'dark', skin: 'default', show_cost: true, show_reasoning: true, tool_progress_command: 'default', background_process_notifications: 'all' },
  memory: { enabled: true, max_entries: 100 },
  cron: { enabled: true, max_jobs: 10 },
  security: { approval_required: false, dangerous_commands: [] },
  _config_version: 5,
};

/** Mock tools for tests */
export const MOCK_TOOLS: ToolEntry[] = [
  {
    name: 'test_tool',
    toolset: 'test',
    schema: {
      name: 'test_tool',
      description: 'A test tool',
      parameters: { type: 'object', properties: {} },
    },
  },
];

/** Mock models for tests */
export const MOCK_MODELS: ModelOption[] = [
  {
    name: 'test/model-a',
    display_name: 'Test Model A',
    context_length: 100000,
    supports_vision: false,
    supports_function_calling: true,
    supports_streaming: true,
    default_temperature: 0.7,
    default_max_tokens: 4096,
    pricing_input: 0.001,
    pricing_output: 0.002,
    enabled: true,
  },
];

/** Mock MCP servers for tests */
export const MOCK_MCP_SERVERS: McpServer[] = [
  {
    name: 'test-server',
    command: 'node',
    args: ['test-server.js'],
    transport: 'stdio',
  },
];

/** Mock cron jobs for tests */
export const MOCK_CRON_JOBS: CronJob[] = [
  {
    id: 'cron_test_1',
    name: 'Test Cron Job',
    prompt: 'Run a test',
    skills: [],
    skill: null,
    model: null,
    provider: null,
    base_url: null,
    api_key: null,
    script: null,
    schedule: { kind: 'once', display: 'Once' },
    schedule_display: 'Once',
    repeat: { times: null, completed: 0 },
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
    deliver: 'origin',
    origin: null,
  },
];

/**
 * Creates a minimal mock stores object for testing components
 * that depend on store context.
 */
export function createMockStores() {
  return {
    sessions: MOCK_SESSIONS,
    config: MOCK_CONFIG,
    tools: MOCK_TOOLS,
    models: MOCK_MODELS,
    mcpServers: MOCK_MCP_SERVERS,
    cronJobs: MOCK_CRON_JOBS,
  };
}
