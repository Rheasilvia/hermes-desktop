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
import {
  MOCK_TOOLS,
  MOCK_MODELS,
  MOCK_MCP_SERVERS,
  MOCK_SKILL_INFOS,
  MOCK_CONFIG,
  MOCK_SESSIONS,
  MOCK_CRON_JOBS,
  MOCK_MEMORY_FILES,
  MOCK_CONTEXT_FILES,
  MOCK_MEMORY_ENTRIES,
  createMockSessionMessages,
} from './fixtures/index.js';

const DEFAULT_DELAY_MIN = 50;
const DEFAULT_DELAY_MAX = 150;

const delay = (min: number, max: number): Promise<void> =>
  new Promise(resolve =>
    setTimeout(resolve, min + Math.random() * (max - min))
  );

const generateId = (): string =>
  Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

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
  private resolveApproval?: () => void;
  private resolveClarify?: () => void;

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
      rename: async (sessionId: string, title: string): Promise<void> => {
        await delay(this.delayMin, this.delayMax);
        const s = [...MOCK_SESSIONS, ...dynamicSessions].find(s => s.id === sessionId);
        if (!s) throw new Error(`Session not found: ${sessionId}`);
        s.title = title;
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
        if (sessionId === 'sess_verify_04_loading') {
          await delay(2000, 2500);
          return [];
        }
        await delay(this.delayMin, this.delayMax);
        if (sessionId === 'sess_verify_04_err') {
          throw new Error('Unable to reach the Hermes gateway. Check your connection.');
        }
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

        // ── Section 07 special-flows simulation ──────────────────────────────
        // 07-A: approval request — card stays until user clicks Allow/Deny.
        if (sessionId === 'sess_verify_07') {
          await delay(400, 600);
          this.emit('approval.request', {
            command: 'write_file("/Users/me/release.txt")',
            description: 'This will overwrite any existing content.',
          });
          await new Promise<void>(resolve => { this.resolveApproval = resolve; });
          this.resolveApproval = undefined;
        }
        // 07-B: clarification request — card stays until user responds.
        if (sessionId === 'sess_verify_07b') {
          await delay(400, 600);
          this.emit('clarify.request', {
            request_id: generateId(),
            question: 'Which environment should I deploy to?',
            choices: ['Production', 'Staging', 'Local dev'],
          });
          await new Promise<void>(resolve => { this.resolveClarify = resolve; });
          this.resolveClarify = undefined;
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
        this.resolveApproval?.();
      },
    };

    this.clarify = {
      respond: async (_params): Promise<void> => {
        await delay(this.delayMin, this.delayMax);
        this.resolveClarify?.();
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
