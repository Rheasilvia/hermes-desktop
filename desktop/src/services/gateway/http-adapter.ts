/**
 * HttpGatewayAdapter — real HTTP+SSE adapter for the Hermes desktop backend.
 *
 * Real methods: session.*, prompt.execute, approval.respond, clarify.respond.
 * All other method groups delegate to an inner MockGatewayAdapter in degraded
 * mode (no connect(), no synthetic events — static method registry only).
 *
 * SSE is via one long-lived EventSource.  On reconnect, each known session's
 * messages are replayed from DB via GET /sessions/{sid}/messages?since={lastSeq}.
 */

import type {
  GatewayAdapter,
  ConnectionState,
  GatewayEventMap,
  SessionListItem,
  SessionMessage,
  SessionMeta,
  SessionInfoPayload,
  HermesConfig,
  ToolEntry,
  CronJob,
  CreateCronJobParams,
  UpdateCronJobParams,
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
  ModelOption,
} from './types.js';
import { MockGatewayAdapter } from './mock-adapter.js';
import { httpClient, type HttpClient } from '@/services/api/http-client.js';

const API_PREFIX = '/desktop/api';

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
  readonly setSessionProvider: GatewayAdapter['setSessionProvider'];

  private state: ConnectionState = 'disconnected';
  private handlers: Map<string, Set<EventHandler<keyof GatewayEventMap>>> = new Map();
  private mock: MockGatewayAdapter;
  private http: HttpClient;
  private eventSource: EventSource | null = null;
  private lastSeq: Map<string, number> = new Map();
  private knownSessionIds: Set<string> = new Set();
  private eventSourceUrl: string = '';

  constructor(http?: HttpClient) {
    this.http = http ?? httpClient;
    // Inner mock in degraded mode — never call connect(), no synthetic events.
    this.mock = new MockGatewayAdapter();

    // ── session methods (REAL) ──────────────────────────────────────────
    this.session = {
      list: async (): Promise<SessionListItem[]> => {
        const rows = await this.http.get<Array<Record<string, unknown>>>(`${API_PREFIX}/sessions`);
        return rows.map((r) => ({
          id: String(r.id ?? ''),
          source: String(r.source ?? 'desktop'),
          model: String(r.model ?? ''),
          title: String(r.title ?? 'Untitled'),
          started_at: String(r.started_at ?? new Date().toISOString()),
          message_count: Number(r.message_count ?? 0),
          tool_call_count: 0,
          workspace_path: (r.workspace_path as string) ?? null,
        }));
      },

      info: async (sessionId: string): Promise<SessionInfoPayload> => {
        const r = await this.http.get<Record<string, unknown>>(`${API_PREFIX}/sessions/${sessionId}`);
        return {
          model: String(r.model ?? ''),
          skills: {},
          tools: { web: [], terminal: [] },
          usage: { calls: 0, input: 0, output: 0, total: 0, cost_usd: 0 },
        };
      },

      create: async (params): Promise<SessionMeta> => {
        const r = await this.http.post<Record<string, unknown>>(`${API_PREFIX}/sessions`, {
          model: params.model,
          system_prompt: params.system_prompt,
          workspace_path: params.workspace_path,
        });
        const sid = String(r.session_id ?? r.id ?? '');
        this.knownSessionIds.add(sid);
        this.lastSeq.set(sid, 0);
        return {
          id: sid,
          source: 'desktop',
          model: String(r.model ?? params.model ?? ''),
          title: 'New Session',
          started_at: String(r.started_at ?? new Date().toISOString()),
          ended_at: null,
          message_count: 0,
          tool_call_count: 0,
          input_tokens: 0,
          output_tokens: 0,
          cache_read_tokens: 0,
          cache_write_tokens: 0,
          reasoning_tokens: 0,
          billing_provider: null,
          billing_base_url: null,
          billing_mode: 'auto',
          estimated_cost_usd: 0,
          actual_cost_usd: null,
          cost_status: null,
          cost_source: null,
          pricing_version: null,
          user_id: null,
          model_config: null,
          system_prompt: params.system_prompt ?? null,
          parent_session_id: null,
          end_reason: null,
          workspace_path: params.workspace_path ?? null,
        };
      },

      delete: async (sessionId: string): Promise<void> => {
        await this.http.delete(`${API_PREFIX}/sessions/${sessionId}`);
        this.knownSessionIds.delete(sessionId);
        this.lastSeq.delete(sessionId);
      },

      rename: async (sessionId: string, title: string): Promise<void> => {
        await this.http.patch(`${API_PREFIX}/sessions/${sessionId}`, { title });
      },

      branch: async (sessionId: string): Promise<SessionMeta> => {
        // Branch = create a new session (no server-side branch yet)
        return this.session.create({ model: undefined, workspace_path: undefined });
      },

      resume: async (_sessionId: string): Promise<void> => {
        // No-op: session is always "resumed" on the backend
      },

      interrupt: async (sessionId: string): Promise<void> => {
        await this.http.post(`${API_PREFIX}/sessions/${sessionId}/interrupt`, {});
      },

      messages: async (sessionId: string): Promise<SessionMessage[]> => {
        const rows = await this.http.get<Array<Record<string, unknown>>>(`${API_PREFIX}/sessions/${sessionId}/messages`);

        // Aggregate ui_messages events into logical SessionMessages.
        // reasoning.delta → accumulated reasoning text
        // message.delta   → accumulated content (fallback if no message.complete)
        // message.complete → final assistant message with content + reasoning
        // turn_error      → error message
        const messages: SessionMessage[] = [];
        let reasoningAcc = '';
        let contentAcc = '';
        let lastAssistant: Partial<SessionMessage> | null = null;

        const flushAssistant = (seq: number) => {
          const content = (lastAssistant?.content) ?? (contentAcc || null);
          const reasoning = reasoningAcc || null;
          if (content || reasoning || lastAssistant) {
            messages.push({
              id: seq,
              session_id: sessionId,
              role: 'assistant',
              content: content ?? '',
              reasoning,
              tool_calls: null,
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
        };

        for (const r of rows) {
          const payload = (r.payload as Record<string, unknown>) ?? {};
          const msgType = String(r.type ?? '');
          const seq = Number(r.seq ?? 0);

          switch (msgType) {
            case 'user': {
              if (lastAssistant || contentAcc || reasoningAcc) {
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
                token_count: (payload.usage as Record<string, number> | undefined)?.total ?? null,
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
        if (lastAssistant || contentAcc || reasoningAcc) {
          const lastSeq = rows.length > 0 ? Number(rows[rows.length - 1].seq ?? 0) : 0;
          flushAssistant(lastSeq);
        }

        return messages;
      },
    };

    // ── prompt.execute (REAL) ───────────────────────────────────────────
    this.prompt = {
      execute: async (params): Promise<void> => {
        await this.http.post(`${API_PREFIX}/prompt/execute`, {
          message: params.message,
          session_id: params.session_id,
          provider: params.provider,
          model: params.model,
        });
        // Events streamed via SSE — no return value
      },
    };

    // ── setSessionProvider (REAL) ────────────────────────────────────────
    this.setSessionProvider = async (sessionId: string, provider: string, model?: string): Promise<void> => {
      await this.http.put(`${API_PREFIX}/sessions/${sessionId}/provider`, {
        provider,
        model,
      });
    };

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

    // ── everything else → mock (degraded mode) ──────────────────────────
    this.config = this.mock.config;
    this.tools = this.mock.tools;
    this.model = this.mock.model;
    this.sudo = this.mock.sudo;
    this.secret = this.mock.secret;
    this.cron = this.mock.cron;
    this.mcp = this.mock.mcp;
    this.memory = this.mock.memory;
    this.skills = this.mock.skills;
    this.complete = this.mock.complete;
    this.slash = this.mock.slash;
    this.command = this.mock.command;
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
  private dispatchSseEvent(event: SseEvent): void {
    const { session_id: sid, seq, type, payload } = event;

    // Track lastSeq for replay
    const current = this.lastSeq.get(sid) ?? 0;
    if (seq > current) {
      this.lastSeq.set(sid, seq);
    }

    // Route to the appropriate GatewayEventMap event
    switch (type) {
      case 'user':
        // User message already rendered by the UI; just track
        break;
      case 'message.delta':
        this.emit('message.delta', { text: String(payload.text ?? '') } as GatewayEventMap['message.delta']);
        break;
      case 'message.complete':
        this.emit('message.complete', {
          text: String(payload.text ?? ''),
          rendered: false,
          usage: payload.usage as GatewayEventMap['message.complete']['usage'],
          status: payload.status as GatewayEventMap['message.complete']['status'],
        } as GatewayEventMap['message.complete']);
        break;
      case 'reasoning.delta':
        this.emit('reasoning.delta', { text: String(payload.text ?? '') } as GatewayEventMap['reasoning.delta']);
        break;
      case 'session.title_update':
        this.emit('session.title_update', {
          session_id: sid,
          title: String(payload.title ?? ''),
        } as GatewayEventMap['session.title_update']);
        break;
      case 'tool.start':
        this.emit('tool.start', {
          tool_id: String(payload.tool_id ?? ''),
          name: String(payload.name ?? ''),
        } as GatewayEventMap['tool.start']);
        break;
      case 'tool.complete':
        this.emit('tool.complete', {
          tool_id: String(payload.tool_id ?? `${payload.name}_0`),
          name: String(payload.name ?? ''),
          summary: String(payload.summary ?? ''),
          duration_s: Number(payload.duration_s ?? 0),
        } as GatewayEventMap['tool.complete']);
        break;
      case 'tool.error':
        this.emit('tool.error', {
          tool_id: String(payload.tool_id ?? ''),
          name: String(payload.name ?? ''),
          error: String(payload.error ?? 'Unknown error'),
          duration_s: Number(payload.duration_s ?? 0),
        } as GatewayEventMap['tool.error']);
        break;
      case 'tool.generating':
        this.emit('tool.generating', {
          tool_id: String(payload.tool_id ?? ''),
          text: String(payload.text ?? ''),
        } as GatewayEventMap['tool.generating']);
        break;
      case 'approval.request':
        this.emit('approval.request', {
          command: String(payload.command ?? ''),
          description: String(payload.description ?? ''),
        } as GatewayEventMap['approval.request']);
        break;
      case 'clarify.request':
        this.emit('clarify.request', {
          request_id: String(payload.request_id ?? ''),
          question: String(payload.question ?? ''),
          choices: (payload.choices as string[]) ?? [],
        } as GatewayEventMap['clarify.request']);
        break;
      case 'message.start':
        this.emit('message.start', {
          message_id: String(payload.message_id ?? ''),
        } as GatewayEventMap['message.start']);
        break;
      case 'turn_error':
        this.emit('error', {
          message: String(payload.error ?? 'Turn error'),
        } as GatewayEventMap['error']);
        break;
      case 'error':
        this.emit('error', {
          message: String(payload.message ?? payload.error ?? 'Unknown error'),
        } as GatewayEventMap['error']);
        break;
      default:
        console.warn('[HttpGatewayAdapter] unknown SSE event type:', type, payload);
    }
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────

  async connect(): Promise<void> {
    this.state = 'connecting';

    // Resolve the EventSource URL (token in query string)
    try {
      const info = await (this.http as unknown as { info: () => Promise<{ base_url: string; token: string }> }).info?.();
      if (info) {
        this.eventSourceUrl = `${info.base_url}${API_PREFIX}/events/stream?token=${encodeURIComponent(info.token)}`;
      }
    } catch {
      // Fallback: use env var
      const baseUrl = import.meta.env.VITE_SIDECAR_URL ?? 'http://127.0.0.1:18080';
      const token = import.meta.env.VITE_SIDECAR_TOKEN ?? '';
      this.eventSourceUrl = `${baseUrl}${API_PREFIX}/events/stream?token=${encodeURIComponent(token)}`;
    }

    // Open SSE connection
    this.eventSource = new EventSource(this.eventSourceUrl);

    this.eventSource.onopen = () => {
      const wasReconnecting = this.state === 'reconnecting';
      this.state = 'connected';
      // Replay missed events for all known sessions
      this._replayAllSessions();
      if (wasReconnecting) {
        this.emit('gateway.ready', { skin: undefined });
      }
    };

    // SSE spec: named events arrive via addEventListener, not onmessage
    this.eventSource.addEventListener('message.delta', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        this.dispatchSseEvent({ ...data, type: 'message.delta' });
      } catch { /* ignore */ }
    });

    this.eventSource.addEventListener('message.complete', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        this.dispatchSseEvent({ ...data, type: 'message.complete' });
      } catch { /* ignore */ }
    });

    this.eventSource.addEventListener('tool.start', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        this.dispatchSseEvent({ ...data, type: 'tool.start' });
      } catch { /* ignore */ }
    });

    this.eventSource.addEventListener('tool.complete', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        this.dispatchSseEvent({ ...data, type: 'tool.complete' });
      } catch { /* ignore */ }
    });

    this.eventSource.addEventListener('tool.error', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        this.dispatchSseEvent({ ...data, type: 'tool.error' });
      } catch { /* ignore */ }
    });

    this.eventSource.addEventListener('reasoning.delta', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        this.dispatchSseEvent({ ...data, type: 'reasoning.delta' });
      } catch { /* ignore */ }
    });

    this.eventSource.addEventListener('session.title_update', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        this.dispatchSseEvent({ ...data, type: 'session.title_update' });
      } catch { /* ignore */ }
    });

    this.eventSource.addEventListener('error', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        this.dispatchSseEvent({ ...data, type: 'error' });
      } catch { /* ignore */ }
    });

    this.eventSource.onerror = () => {
      if (this.state === 'connected') {
        this.state = 'reconnecting';
      }
      // EventSource auto-reconnects; onopen will trigger replay
    };
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
