/**
 * HttpGatewayAdapter — real HTTP+SSE adapter for the Hermes desktop backend.
 *
 * Real methods: session.*, prompt.execute, approval.respond, clarify.respond,
 * complete.slash, slash.exec, command.dispatch.
 * Resource-style method groups proxy to sidecar REST endpoints for compatibility;
 * user-facing resource pages should prefer services/api transports directly.
 *
 * SSE is via one long-lived EventSource.  On reconnect, each known session's
 * messages are replayed from DB via GET /sessions/{sid}/messages?since={lastSeq}.
 */

import type {
  GatewayAdapter,
  ConnectionState,
  GatewayEventEnvelope,
  GatewayEventMap,
  SessionMessage,
  HermesConfig,
  ToolEntry,
  CronJob,
  CreateCronJobParams,
  UpdateCronJobParams,
  McpServer,
  McpTool,
  MemoryFile,
  MemoryFileWithContent,
  MemoryProject,
  MemorySearchHit,
  MemoryScope,
  WellKnownMemoryName,
  SkillInfo,
} from './types.js';
import type { ParsedToolCall } from '@/types/index.js';
import { httpClient, type HttpClient } from '@/services/api/http-client.js';
import type { ConfigReadResponse } from '@/services/api/types.js';
import {
  makeCommandGateway,
  makeCompleteGateway,
  makeSlashGateway,
  mapCommandResult,
} from './http/commands.js';
import {
  makeImageGateway,
  makePromptGateway,
  makeSessionGateway,
  makeSessionProviderSetter,
} from './http/session-prompt.js';
import { openEventSource, resolveEventSourceUrl } from './http/sse-lifecycle.js';
import { API_PREFIX, cloneConfig, setDotPath } from './http/shared.js';
import { makeGitGateway, makeWorkspaceGateway } from './http/workspace-git.js';

export { mapCommandResult };

type EventHandler<K extends keyof GatewayEventMap> = (payload: GatewayEventMap[K]) => void;

/** SSE event shape from the backend. */
interface SseEvent {
  session_id: string;
  seq: number;
  type: string;
  payload: Record<string, unknown>;
}

export class HttpGatewayAdapter implements GatewayAdapter {
  readonly session: GatewayAdapter['session'];
  readonly prompt: GatewayAdapter['prompt'];
  readonly image: GatewayAdapter['image'];
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
  readonly workspace: GatewayAdapter['workspace'];
  readonly git: GatewayAdapter['git'];
  readonly slash: GatewayAdapter['slash'];
  readonly command: GatewayAdapter['command'];
  readonly delegation: GatewayAdapter['delegation'];
  readonly subagent: GatewayAdapter['subagent'];
  readonly setSessionProvider: GatewayAdapter['setSessionProvider'];

  private state: ConnectionState = 'disconnected';
  private handlers: Map<string, Set<EventHandler<keyof GatewayEventMap>>> = new Map();
  private http: HttpClient;
  private eventSource: EventSource | null = null;
  private lastSeq: Map<string, number> = new Map();
  private knownSessionIds: Set<string> = new Set();
  private eventSourceUrl: string = '';

  constructor(http?: HttpClient) {
    this.http = http ?? httpClient;

    this.session = makeSessionGateway({
      http: this.http,
      aggregateEventRows: (sessionId, rows) => this.aggregateEventRows(sessionId, rows),
      rememberSession: (sessionId, seq) => {
        this.knownSessionIds.add(sessionId);
        if (seq !== undefined) this.lastSeq.set(sessionId, seq);
      },
      forgetSession: (sessionId) => {
        this.knownSessionIds.delete(sessionId);
        this.lastSeq.delete(sessionId);
      },
      updateLastSeq: (sessionId, seq) => this.lastSeq.set(sessionId, seq),
      getLastSeq: (sessionId) => this.lastSeq.get(sessionId) ?? 0,
    });
    this.prompt = makePromptGateway(this.http);
    this.image = makeImageGateway(this.http);
    this.setSessionProvider = makeSessionProviderSetter(this.http);

    // ── approval / clarify (REAL) ───────────────────────────────────────
    this.approval = {
      respond: async (params): Promise<void> => {
        await this.http.post(`${API_PREFIX}/approval/respond`, {
          session_id: params.session_id,
          command: params.command,
          choice: params.choice,
        });
      },
    };

    this.clarify = {
      respond: async (params): Promise<void> => {
        await this.http.post(`${API_PREFIX}/clarify/respond`, {
          session_id: params.session_id,
          request_id: params.request_id,
          answer: params.answer,
        });
      },
    };

    // ── provider (REAL) ────────────────────────────────────────────────
    this.provider = {
      upsert: async (input): Promise<{ name: string }> => {
        await this.http.post(`${API_PREFIX}/model/providers`, {
          name: input.name,
          api_key: input.api_key,
          base_url: input.base_url,
          display_name: input.display_name,
          api_key_env: input.api_key_env,
          is_builtin: input.is_builtin,
        });
        return { name: input.name };
      },
      delete: async (input): Promise<{ ok: boolean }> => {
        await this.http.delete(`${API_PREFIX}/model/providers/${encodeURIComponent(input.name)}`);
        return { ok: true };
      },
    };

    this.config = {
      get: async (): Promise<HermesConfig> => {
        const response = await this.http.get<ConfigReadResponse>(`${API_PREFIX}/config`);
        return response.config as HermesConfig;
      },
      getMtime: async () => {
        const response = await this.http.get<ConfigReadResponse>(`${API_PREFIX}/config`);
        return response.mtime;
      },
      set: async (input: import('./types.js').ConfigSetInput) => {
        if (input.key === 'model' && typeof input.value === 'string') {
          const [provider, model] = input.value.split('/');
          if (provider && model) {
            await this.http.put(`${API_PREFIX}/model/active`, { provider, model });
            return;
          }
        }
        if (/^(tts|stt|voice)\./.test(input.key)) {
          const current = await this.http.get<ConfigReadResponse>(`${API_PREFIX}/config`);
          const nextConfig = cloneConfig(current.config as HermesConfig);
          setDotPath(nextConfig, input.key, input.value);
          await this.http.put(`${API_PREFIX}/config`, {
            config: nextConfig,
            base_mtime: current.mtime,
            changed_paths: [input.key],
          });
          return;
        }
        throw new Error(`config.set: unsupported key '${input.key}'`);
      },
    };
    this.tools = {
      list: async (): Promise<ToolEntry[]> => {
        const r = await this.http.get<{ items: Array<Record<string, unknown>> }>(`${API_PREFIX}/tools`);
        return r.items.map((item) => ({
          name: String(item.name ?? ''),
          toolset: String(item.toolset ?? ''),
          schema: (item.schema ?? { name: item.name, description: item.description ?? '' }) as ToolEntry['schema'],
          description: item.description as string | undefined,
        }));
      },
      reload: async (): Promise<void> => {
        await this.http.post(`${API_PREFIX}/tools/reload`, {});
      },
    };
    this.model = {
      options: async (_sessionId?: string): Promise<import('./types.js').ModelOptionsResult> => {
        const [providersRes, activeRes] = await Promise.all([
          this.http.get(`${API_PREFIX}/model/providers`) as Promise<Record<string, unknown>>,
          this.http.get(`${API_PREFIX}/model/active`) as Promise<Record<string, unknown>>,
        ]);
        const items = (providersRes.items ?? []) as Record<string, unknown>[];
        const providers: import('@/types/index.js').ProviderEntry[] = items.map((p) => {
          const desktop = (p.desktop ?? {}) as Record<string, unknown>;
          const models = (p.models ?? []) as Record<string, unknown>[];
          return {
            name: (p.id ?? p.name ?? '') as string,
            models: models.map((m) => ({ name: (m.id ?? m.name ?? '') as string })),
            base_url: (desktop.base_url as string) ?? undefined,
            api_key_preview: (desktop.api_key_preview as string) ?? undefined,
            api_key_set: (desktop.api_key_set as boolean) ?? false,
          };
        });
        return {
          providers,
          model: (activeRes.model ?? '') as string,
          provider: (activeRes.provider ?? '') as string,
        };
      },
    };
    this.sudo = {
      respond: async (params: { request_id: string; password: string }): Promise<void> => {
        await this.http.post(`${API_PREFIX}/sudo/respond`, params);
      },
    };
    this.secret = {
      respond: async (params: { request_id: string; value: string }): Promise<void> => {
        await this.http.post(`${API_PREFIX}/secret/respond`, params);
      },
    };
    this.cron = {
      list: async (): Promise<CronJob[]> => {
        const r = await this.http.get<{ items: CronJob[] }>(`${API_PREFIX}/cron/jobs`);
        return r.items;
      },
      create: async (job: CreateCronJobParams): Promise<CronJob> =>
        this.http.post<CronJob>(`${API_PREFIX}/cron/jobs`, job),
      update: async (id: string, job: UpdateCronJobParams): Promise<CronJob> =>
        this.http.patch<CronJob>(`${API_PREFIX}/cron/jobs/${encodeURIComponent(id)}`, job),
      delete: async (id: string): Promise<void> => {
        await this.http.delete(`${API_PREFIX}/cron/jobs/${encodeURIComponent(id)}`);
      },
    };
    this.mcp = {
      list: async (): Promise<McpServer[]> => {
        const r = await this.http.get<{ items: McpServer[] }>(`${API_PREFIX}/mcp/servers`);
        return r.items;
      },
      add: async (server: Partial<McpServer>): Promise<McpServer> =>
        this.http.post<McpServer>(`${API_PREFIX}/mcp/servers`, server),
      remove: async (name: string): Promise<void> => {
        await this.http.delete(`${API_PREFIX}/mcp/servers/${encodeURIComponent(name)}`);
      },
      tools: async (serverName: string): Promise<McpTool[]> => {
        const r = await this.http.get<{ items: McpTool[] }>(
          `${API_PREFIX}/mcp/servers/${encodeURIComponent(serverName)}/tools`,
        );
        return r.items;
      },
    };
    this.memory = {
      projects: async (): Promise<MemoryProject[]> => {
        const r = await this.http.get<{ projects: MemoryProject[] }>(
          `${API_PREFIX}/memory/projects`,
        );
        return r.projects;
      },
      files: async (
        scope: MemoryScope,
        workspace?: string,
      ): Promise<MemoryFile[]> => {
        const qs = new URLSearchParams({ scope });
        if (workspace) qs.set('workspace', workspace);
        const r = await this.http.get<{ files: MemoryFile[] }>(
          `${API_PREFIX}/memory/files?${qs.toString()}`,
        );
        return r.files;
      },
      readFile: async (
        scope: MemoryScope,
        name: WellKnownMemoryName,
        workspace?: string,
      ): Promise<MemoryFileWithContent> => {
        const qs = new URLSearchParams({ scope, name });
        if (workspace) qs.set('workspace', workspace);
        return this.http.get<MemoryFileWithContent>(
          `${API_PREFIX}/memory/file?${qs.toString()}`,
        );
      },
      writeFile: async (args: {
        scope: MemoryScope;
        name: WellKnownMemoryName;
        workspace?: string;
        content: string;
        ifMatch?: string;
      }): Promise<MemoryFileWithContent> => {
        const headers: Record<string, string> = {};
        if (args.ifMatch) headers['If-Match'] = args.ifMatch;
        return this.http.put<MemoryFileWithContent>(
          `${API_PREFIX}/memory/file`,
          {
            scope: args.scope,
            name: args.name,
            workspace: args.workspace,
            content: args.content,
          },
          headers,
        );
      },
      search: async (
        query: string,
        opts?: { scope?: MemoryScope; workspace?: string },
      ): Promise<MemorySearchHit[]> => {
        const r = await this.http.post<{ hits: MemorySearchHit[] }>(
          `${API_PREFIX}/memory/search`,
          {
            query,
            scope: opts?.scope,
            workspace: opts?.workspace,
          },
        );
        return r.hits;
      },
    };
    this.skills = {
      list: async (): Promise<SkillInfo[]> => {
        const r = await this.http.get<{ items: SkillInfo[] }>(`${API_PREFIX}/skills`);
        return r.items;
      },
    };
    this.complete = makeCompleteGateway(this.http);
    this.workspace = makeWorkspaceGateway(this.http);
    this.git = makeGitGateway(this.http);
    this.slash = makeSlashGateway(this.http);
    this.command = makeCommandGateway(this.http);
    this.delegation = {
      status: async () => this.http.get(`${API_PREFIX}/delegation/status`),
      pause: async (params) => this.http.post(`${API_PREFIX}/delegation/pause`, params),
    };
    this.subagent = {
      interrupt: async (params) => this.http.post(
        `${API_PREFIX}/subagents/${encodeURIComponent(params.subagent_id)}/interrupt`,
        {},
      ),
    };
  }

  // ── Message aggregation ───────────────────────────────────────────────

  /**
   * Aggregate raw event rows (from the DB) into logical SessionMessage[].
   *
   * Handles:
   *   tool.start / tool.generating / tool.complete / tool.error → tool_calls per turn
   *   reasoning.delta → accumulated reasoning text
   *   message.delta   → accumulated content (fallback if no message.complete)
   *   message.complete → flush assistant message with content + reasoning + tool_calls
   *   turn_error      → flush assistant message with error content
   *   user            → user message
   */
  aggregateEventRows(
    sessionId: string,
    rows: Array<Record<string, unknown>>,
  ): SessionMessage[] {
    const messages: SessionMessage[] = [];
    let reasoningAcc = '';
    let contentAcc = '';
    let lastAssistant: Partial<SessionMessage> | null = null;
    let seqCounter = 0;
    const pendingTools = new Map<string, ParsedToolCall & { seqIndex: number }>();
    const inputAccumulator = new Map<string, string>();

    const flushAssistant = (seq: number) => {
      const content = lastAssistant?.content ?? (contentAcc || null);
      const reasoning = reasoningAcc || null;
      if (content || reasoning || lastAssistant || pendingTools.size > 0) {
        const tool_calls: ParsedToolCall[] | null =
          pendingTools.size > 0
            ? [...pendingTools.values()]
                .sort((a, b) => a.seqIndex - b.seqIndex)
                .map(({ seqIndex: _s, ...tc }) => tc)
            : null;
        messages.push({
          id: seq,
          session_id: sessionId,
          role: 'assistant',
          content: content ?? '',
          reasoning,
          tool_calls,
          tool_call_id: null,
          tool_name: null,
          timestamp: new Date().toISOString(),
          token_count: (lastAssistant?.token_count as number) ?? null,
          finish_reason: null,
        } as unknown as SessionMessage);
      }
      reasoningAcc = '';
      contentAcc = '';
      lastAssistant = null;
      seqCounter = 0;
      pendingTools.clear();
      inputAccumulator.clear();
    };

    for (const r of rows) {
      const payload = (r.payload as Record<string, unknown>) ?? {};
      const msgType = String(r.type ?? '');
      const seq = Number(r.seq ?? 0);

      switch (msgType) {
        case 'user': {
          if (lastAssistant || contentAcc || reasoningAcc || pendingTools.size > 0) {
            flushAssistant(seq - 1);
          }
          messages.push({
            id: seq,
            session_id: sessionId,
            role: 'user',
            content: String(payload.text ?? ''),
            reasoning: null,
            tool_calls: null,
            tool_call_id: null,
            tool_name: null,
            timestamp: new Date().toISOString(),
            token_count: null,
            finish_reason: null,
          } as unknown as SessionMessage);
          break;
        }
        case 'tool.start': {
          const id = String(payload.tool_id ?? '');
          const existing = pendingTools.get(id);
          pendingTools.set(id, {
            id,
            name: String(payload.name ?? existing?.name ?? ''),
            arguments: existing?.arguments ?? {},
            status: 'running',
            outputSummary: existing?.outputSummary ?? null,
            durationMs: existing?.durationMs ?? null,
            seqIndex: existing?.seqIndex ?? seqCounter++,
          });
          break;
        }
        case 'tool.generating': {
          const id = String(payload.tool_id ?? '');
          if (!id) break;
          if (!pendingTools.has(id)) {
            pendingTools.set(id, {
              id,
              name: String(payload.name ?? ''),
              arguments: {},
              status: 'running',
              outputSummary: null,
              durationMs: null,
              seqIndex: seqCounter++,
            });
          }
          inputAccumulator.set(id, (inputAccumulator.get(id) ?? '') + String(payload.text ?? ''));
          break;
        }
        case 'tool.complete': {
          const id = String(payload.tool_id ?? '');
          const tc = pendingTools.get(id);
          if (tc) {
            let args: Record<string, unknown> = {};
            try { args = JSON.parse(inputAccumulator.get(id) ?? '{}'); } catch { /* leave empty */ }
            const todos = Array.isArray(payload.todos)
              ? (payload.todos as Array<Record<string, unknown>>).map((t) => ({
                  id: String(t.id ?? ''),
                  content: String(t.content ?? ''),
                  status: String(t.status ?? 'pending') as 'cancelled' | 'completed' | 'in_progress' | 'pending',
                }))
              : undefined;
            pendingTools.set(id, {
              ...tc,
              arguments: args,
              status: 'complete',
              outputSummary: payload.summary != null ? String(payload.summary) : null,
              durationMs: payload.duration_s != null ? Math.round(Number(payload.duration_s) * 1000) : null,
              todos,
            });
          }
          break;
        }
        case 'tool.error': {
          const id = String(payload.tool_id ?? '');
          const tc = pendingTools.get(id);
          if (tc) {
            const errorDurationMs = payload.duration_s != null ? Math.round(Number(payload.duration_s) * 1000) : null;
            pendingTools.set(id, {
              ...tc,
              status: 'error',
              durationMs: errorDurationMs ?? undefined,
            });
          }
          break;
        }
        case 'reasoning.delta': {
          reasoningAcc += String(payload.text ?? '');
          break;
        }
        case 'message.delta': {
          contentAcc += String(payload.text ?? '');
          break;
        }
        case 'message.complete': {
          lastAssistant = {
            content: String(payload.text ?? ''),
            token_count: (payload.usage as Record<string, number> | undefined)?.total ?? undefined,
          };
          flushAssistant(seq);
          break;
        }
        case 'turn_error': {
          lastAssistant = {
            content: String(payload.error ?? 'Error occurred'),
          };
          flushAssistant(seq);
          break;
        }
      }
    }

    // Flush any trailing partial assistant turn (interrupted streaming)
    if (lastAssistant || contentAcc || reasoningAcc || pendingTools.size > 0) {
      const lastRowSeq = rows.length > 0 ? Number(rows[rows.length - 1].seq ?? 0) : 0;
      flushAssistant(lastRowSeq);
    }

    return messages;
  }

  // ── Event emitter ─────────────────────────────────────────────────────

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

  /** Map an SSE ui_message type to a GatewayEventMap key and transform the payload. */
  private normalizeSseEvent(event: SseEvent): GatewayEventEnvelope {
    return {
      sessionId: String(event.session_id ?? ''),
      seq: Number(event.seq ?? 0),
      type: String(event.type ?? ''),
      payload: (event.payload as Record<string, unknown>) ?? {},
      receivedAt: Date.now(),
    };
  }

  private dispatchSseEvent(event: SseEvent): void {
    const envelope = this.normalizeSseEvent(event);
    const { sessionId: sid, seq, type, payload } = envelope;
    if (!sid) return;
    const turnId = payload.turn_id != null ? String(payload.turn_id) : undefined;
    const eventSeq = seq > 0 ? seq : undefined;

    // Track lastSeq for replay
    const current = this.lastSeq.get(sid) ?? 0;
    if (seq > 0 && seq <= current) {
      return;
    }
    this.knownSessionIds.add(sid);
    if (seq > current) {
      this.lastSeq.set(sid, seq);
    }

    // Route to the appropriate GatewayEventMap event
    switch (type) {
      case 'user':
        // User message already rendered by the UI; just track
        break;
      case 'message.delta':
        this.emit('message.delta', {
          session_id: sid,
          text: String(payload.text ?? ''),
          turn_id: turnId,
          event_seq: eventSeq,
        } as GatewayEventMap['message.delta']);
        break;
      case 'message.complete':
        this.emit('message.complete', {
          session_id: sid,
          text: String(payload.text ?? ''),
          rendered: false,
          usage: payload.usage as GatewayEventMap['message.complete']['usage'],
          status: payload.status as GatewayEventMap['message.complete']['status'],
          turn_id: turnId,
          event_seq: eventSeq,
        } as GatewayEventMap['message.complete']);
        break;
      case 'plan.delta':
        this.emit('plan.delta', {
          session_id: sid,
          text: String(payload.text ?? ''),
          turn_id: turnId,
          event_seq: eventSeq,
        } as GatewayEventMap['plan.delta']);
        break;
      case 'plan.complete':
        this.emit('plan.complete', {
          session_id: sid,
          turn_id: turnId,
          event_seq: eventSeq,
        } as GatewayEventMap['plan.complete']);
        break;
      case 'reasoning.delta':
        this.emit('reasoning.delta', {
          session_id: sid,
          text: String(payload.text ?? ''),
          turn_id: turnId,
          event_seq: eventSeq,
        } as GatewayEventMap['reasoning.delta']);
        break;
      case 'session.title_update':
        this.emit('session.title_update', {
          session_id: sid,
          title: String(payload.title ?? ''),
        } as GatewayEventMap['session.title_update']);
        break;
      case 'tool.start':
        this.emit('tool.start', {
          session_id: sid,
          tool_id: String(payload.tool_id ?? ''),
          name: String(payload.name ?? ''),
          turn_id: turnId,
          event_seq: eventSeq,
        } as GatewayEventMap['tool.start']);
        break;
      case 'tool.complete': {
        const completePayload: GatewayEventMap['tool.complete'] = {
          session_id: sid,
          tool_id: String(payload.tool_id ?? `${payload.name}_0`),
          name: String(payload.name ?? ''),
          summary: String(payload.summary ?? ''),
          duration_s: Number(payload.duration_s ?? 0),
          turn_id: turnId,
          event_seq: eventSeq,
        };
        if (payload.todos && Array.isArray(payload.todos)) {
          completePayload.todos = payload.todos as GatewayEventMap['tool.complete']['todos'];
        }
        this.emit('tool.complete', completePayload);
        break;
      }
      case 'tool.error':
        this.emit('tool.error', {
          session_id: sid,
          tool_id: String(payload.tool_id ?? ''),
          name: String(payload.name ?? ''),
          error: String(payload.error ?? 'Unknown error'),
          duration_s: Number(payload.duration_s ?? 0),
          turn_id: turnId,
          event_seq: eventSeq,
        } as GatewayEventMap['tool.error']);
        break;
      case 'tool.generating':
        this.emit('tool.generating', {
          session_id: sid,
          tool_id: String(payload.tool_id ?? ''),
          name: String(payload.name ?? ''),
          text: String(payload.text ?? ''),
          turn_id: turnId,
          event_seq: eventSeq,
        } as GatewayEventMap['tool.generating']);
        break;
      case 'subagent.start':
        this.emit('subagent.start', {
          session_id: sid,
          subagent_id: String(payload.subagent_id ?? ''),
          goal: String(payload.goal ?? ''),
          parent_id: payload.parent_id != null ? String(payload.parent_id) : undefined,
          model: payload.model != null ? String(payload.model) : undefined,
          depth: payload.depth != null ? Number(payload.depth) : undefined,
          task_count: payload.task_count != null ? Number(payload.task_count) : undefined,
          task_index: payload.task_index != null ? Number(payload.task_index) : undefined,
        } as GatewayEventMap['subagent.start']);
        break;
      case 'subagent.progress':
        this.emit('subagent.progress', {
          session_id: sid,
          subagent_id: String(payload.subagent_id ?? ''),
          status: payload.status != null ? String(payload.status) : undefined,
          tool_count: payload.tool_count != null ? Number(payload.tool_count) : undefined,
          toolsets: payload.toolsets != null ? (payload.toolsets as string[]) : undefined,
        } as GatewayEventMap['subagent.progress']);
        break;
      case 'subagent.complete':
        this.emit('subagent.complete', {
          session_id: sid,
          subagent_id: String(payload.subagent_id ?? ''),
          summary: payload.summary != null ? String(payload.summary) : undefined,
          duration_seconds: payload.duration_seconds != null ? Number(payload.duration_seconds) : undefined,
          cost_usd: payload.cost_usd != null ? Number(payload.cost_usd) : undefined,
          input_tokens: payload.input_tokens != null ? Number(payload.input_tokens) : undefined,
          output_tokens: payload.output_tokens != null ? Number(payload.output_tokens) : undefined,
          reasoning_tokens: payload.reasoning_tokens != null ? Number(payload.reasoning_tokens) : undefined,
          api_calls: payload.api_calls != null ? Number(payload.api_calls) : undefined,
          files_read: payload.files_read != null ? Number(payload.files_read) : undefined,
          files_written: payload.files_written != null ? Number(payload.files_written) : undefined,
        } as GatewayEventMap['subagent.complete']);
        break;
      case 'subagent.tool':
        this.emit('subagent.tool', {
          session_id: sid,
          subagent_id: String(payload.subagent_id ?? ''),
          tool_name: payload.tool_name != null ? String(payload.tool_name) : undefined,
          tool_preview: payload.tool_preview != null ? String(payload.tool_preview) : undefined,
          text: payload.text != null ? String(payload.text) : undefined,
        } as GatewayEventMap['subagent.tool']);
        break;
      case 'subagent.error':
        this.emit('subagent.error', {
          session_id: sid,
          subagent_id: String(payload.subagent_id ?? ''),
          status: payload.status != null ? String(payload.status) : undefined,
          text: payload.text != null ? String(payload.text) : undefined,
        } as GatewayEventMap['subagent.error']);
        break;
      case 'tool.progress':
        this.emit('tool.progress', {
          session_id: sid,
          tool_id: payload.tool_id != null ? String(payload.tool_id) : undefined,
          name: String(payload.name ?? ''),
          preview: payload.preview != null ? String(payload.preview) : undefined,
          progress: payload.progress != null ? String(payload.progress) : undefined,
          turn_id: turnId,
          event_seq: eventSeq,
        } as GatewayEventMap['tool.progress']);
        break;
      case 'approval.request':
        this.emit('approval.request', {
          session_id: sid,
          command: String(payload.command ?? ''),
          description: String(payload.description ?? ''),
          is_path_approval: Boolean(payload.is_path_approval),
        } as GatewayEventMap['approval.request']);
        break;
      case 'sudo.request':
        this.emit('sudo.request', {
          session_id: sid,
          request_id: String(payload.request_id ?? ''),
        } as GatewayEventMap['sudo.request']);
        break;
      case 'secret.request':
        this.emit('secret.request', {
          session_id: sid,
          request_id: String(payload.request_id ?? ''),
          prompt: String(payload.prompt ?? ''),
          env_var: String(payload.env_var ?? ''),
        } as GatewayEventMap['secret.request']);
        break;
      case 'clarify.request':
        this.emit('clarify.request', {
          session_id: sid,
          request_id: String(payload.request_id ?? ''),
          question: String(payload.question ?? ''),
          choices: (payload.choices as string[]) ?? [],
        } as GatewayEventMap['clarify.request']);
        break;
      case 'message.start':
        this.emit('message.start', {
          message_id: String(payload.message_id ?? ''),
          turn_id: turnId,
          event_seq: eventSeq,
        } as GatewayEventMap['message.start']);
        break;
      case 'status.update':
        this.emit('status.update', {
          kind: String(payload.kind ?? 'status'),
          text: String(payload.text ?? ''),
        } as GatewayEventMap['status.update']);
        break;
      case 'background.complete':
        this.emit('background.complete', {
          task_id: String(payload.task_id ?? ''),
          text: String(payload.text ?? ''),
        } as GatewayEventMap['background.complete']);
        break;
      case 'btw.complete':
        this.emit('btw.complete', {
          text: String(payload.text ?? ''),
        } as GatewayEventMap['btw.complete']);
        break;
      case 'gateway.stderr':
        this.emit('gateway.stderr', {
          text: String(payload.text ?? ''),
        } as GatewayEventMap['gateway.stderr']);
        break;
      case 'gateway.protocol_error':
        this.emit('gateway.protocol_error', {
          message: String(payload.message ?? ''),
        } as GatewayEventMap['gateway.protocol_error']);
        break;
      case 'model.changed':
        this.emit('model.changed', {
          provider: String(payload.provider ?? ''),
          model: String(payload.model ?? ''),
        } as GatewayEventMap['model.changed']);
        break;
      case 'turn_error':
        this.emit('error', {
          session_id: sid,
          message: String(payload.message ?? payload.error ?? 'Turn error'),
          code: payload.code != null ? String(payload.code) : undefined,
          hint: payload.hint != null ? String(payload.hint) : undefined,
          turn_id: turnId,
          event_seq: eventSeq,
        } as GatewayEventMap['error']);
        break;
      case 'error':
        this.emit('error', {
          session_id: sid,
          message: String(payload.message ?? payload.error ?? 'Unknown error'),
          code: payload.code != null ? String(payload.code) : undefined,
          hint: payload.hint != null ? String(payload.hint) : undefined,
          turn_id: turnId,
          event_seq: eventSeq,
        } as GatewayEventMap['error']);
        break;
      case 'turn.interrupted':
        this.emit('turn.interrupted', {
          session_id: sid,
          reason: payload.reason != null ? String(payload.reason) : undefined,
          turn_id: turnId,
          event_seq: eventSeq,
        } as GatewayEventMap['turn.interrupted']);
        break;
      default:
        console.warn('[HttpGatewayAdapter] unknown SSE event type:', type, payload);
    }
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────

  async connect(): Promise<void> {
    this.state = 'connecting';
    this.eventSourceUrl = await resolveEventSourceUrl(this.http);
    this.eventSource = await openEventSource(this.eventSourceUrl, {
      onMessage: (data) => {
        if (data && typeof data === 'object' && 'type' in data) {
          this.dispatchSseEvent(data as SseEvent);
        }
      },
      onError: () => {
        if (this.state === 'connected') {
          this.state = 'reconnecting';
        }
      },
      onOpen: () => {
        this.state = 'connected';
        this._replayAllSessions();
        this.emit('gateway.ready', { skin: undefined });
      },
    });
  }

  async disconnect(): Promise<void> {
    this.eventSource?.close();
    this.eventSource = null;
    this.handlers.clear();
    this.state = 'disconnected';
  }

  getConnectionState(): ConnectionState {
    return this.state;
  }

  // ── Replay ────────────────────────────────────────────────────────────

  private async _replayAllSessions(): Promise<void> {
    for (const sid of this.knownSessionIds) {
      await this._replaySession(sid);
    }
  }

  private async _replaySession(sessionId: string): Promise<void> {
    const lastSeq = this.lastSeq.get(sessionId) ?? 0;
    try {
      const rows = await this.http.get<Array<Record<string, unknown>>>(`${API_PREFIX}/sessions/${sessionId}/messages?since=${lastSeq}`);
      for (const row of rows) {
        const event: SseEvent = {
          session_id: String(row.session_id ?? sessionId),
          seq: Number(row.seq ?? 0),
          type: String(row.type ?? ''),
          payload: (row.payload as Record<string, unknown>) ?? {},
        };
        // Only process events strictly newer than lastSeq
        if (event.seq > lastSeq) {
          this.dispatchSseEvent(event);
        }
      }
    } catch {
      // Session may have been deleted — ignore
    }
  }
}

/** Create an HttpGatewayAdapter instance. */
export function createHttpGateway(http?: HttpClient): GatewayAdapter {
  return new HttpGatewayAdapter(http);
}
