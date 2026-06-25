import type { HttpClient } from '@/services/api/http-client.js';
import type {
  DesktopPermissionMode,
  GatewayAdapter,
  SessionInfoPayload,
  SessionListItem,
  SessionMessage,
  SessionMeta,
  SessionRuntime,
  SessionRuntimeUpdateResult,
  SessionSteerResponse,
  SessionTranscript,
} from '../types.js';
import { API_PREFIX, permissionModeOf, sessionRuntimeOf } from './shared.js';

interface SessionGatewayDeps {
  http: HttpClient;
  aggregateEventRows(sessionId: string, rows: Array<Record<string, unknown>>): SessionMessage[];
  rememberSession(sessionId: string, seq?: number): void;
  forgetSession(sessionId: string): void;
  updateLastSeq(sessionId: string, seq: number): void;
  getLastSeq(sessionId: string): number;
}

function emptySessionMeta(
  id: string,
  overrides: Partial<SessionMeta> = {},
): SessionMeta {
  return {
    id,
    source: 'desktop',
    model: '',
    title: 'New Session',
    started_at: new Date().toISOString(),
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
    system_prompt: null,
    parent_session_id: null,
    end_reason: null,
    cwd: null,
    archived: false,
    archivedAt: null,
    permissionMode: 'auto',
    runtime: { reasoningEffort: 'medium', collaborationMode: 'default' },
    ...overrides,
  };
}

function mapRuntimeUpdate(sessionId: string, r: Record<string, unknown>): SessionRuntimeUpdateResult {
  return {
    id: String(r.id ?? sessionId),
    runtime: sessionRuntimeOf(r.runtime),
    appliedToActiveTurn: Boolean(r.appliedToActiveTurn),
    appliesNextTurn: Boolean(r.appliesNextTurn),
  };
}

export function makeSessionGateway(deps: SessionGatewayDeps): GatewayAdapter['session'] {
  const { http } = deps;
  return {
    list: async (options): Promise<SessionListItem[]> => {
      const qs = options?.archived ? `?archived=${encodeURIComponent(options.archived)}` : '';
      const rows = await http.get<Array<Record<string, unknown>>>(`${API_PREFIX}/sessions${qs}`);
      return rows.map((r) => ({
        id: String(r.id ?? ''),
        source: String(r.source ?? 'desktop'),
        model: String(r.model ?? ''),
        provider: (r.provider as string | null) ?? null,
        title: String(r.title ?? 'Untitled'),
        started_at: String(r.started_at ?? new Date().toISOString()),
        message_count: Number(r.message_count ?? 0),
        tool_call_count: 0,
        cwd: (r.cwd as string) ?? null,
        archived: Boolean(r.archived),
        archivedAt: typeof r.archivedAt === 'number' ? r.archivedAt : null,
        permissionMode: permissionModeOf(r.permissionMode),
        runtime: sessionRuntimeOf(r.runtime),
      }));
    },

    info: async (sessionId: string): Promise<SessionInfoPayload> => {
      const r = await http.get<Record<string, unknown>>(`${API_PREFIX}/sessions/${sessionId}`);
      return {
        model: String(r.model ?? ''),
        skills: {},
        tools: { web: [], terminal: [] },
        usage: { calls: 0, input: 0, output: 0, total: 0, cost_usd: 0 },
      };
    },

    create: async (params): Promise<SessionMeta> => {
      const r = await http.post<Record<string, unknown>>(`${API_PREFIX}/sessions`, {
        model: params.model,
        provider: params.provider,
        system_prompt: params.system_prompt,
        cwd: params.cwd,
      });
      const sid = String(r.session_id ?? r.id ?? '');
      deps.rememberSession(sid, 0);
      return emptySessionMeta(sid, {
        model: String(r.model ?? params.model ?? ''),
        started_at: String(r.started_at ?? new Date().toISOString()),
        system_prompt: params.system_prompt ?? null,
        cwd: (r.cwd as string) ?? params.cwd ?? null,
        archived: Boolean(r.archived),
        archivedAt: typeof r.archivedAt === 'number' ? r.archivedAt : null,
        permissionMode: permissionModeOf(r.permissionMode),
        runtime: sessionRuntimeOf(r.runtime),
      });
    },

    delete: async (sessionId: string): Promise<void> => {
      await http.delete(`${API_PREFIX}/sessions/${sessionId}`);
      deps.forgetSession(sessionId);
    },

    rename: async (sessionId: string, title: string): Promise<void> => {
      await http.patch(`${API_PREFIX}/sessions/${sessionId}`, { title });
    },

    setArchived: async (
      sessionId: string,
      archived: boolean,
    ): Promise<{ archived: boolean; archivedAt?: number | null }> => {
      const r = await http.patch<Record<string, unknown>>(`${API_PREFIX}/sessions/${sessionId}`, { archived });
      return {
        archived: Boolean(r.archived),
        archivedAt: typeof r.archivedAt === 'number' ? r.archivedAt : null,
      };
    },

    updateCwd: async (sessionId: string, cwd: string): Promise<{ cwd: string }> => {
      const r = await http.patch<Record<string, unknown>>(`${API_PREFIX}/sessions/${sessionId}`, { cwd });
      return { cwd: String(r.cwd ?? cwd) };
    },

    setPermissionMode: async (sessionId: string, mode: DesktopPermissionMode) => {
      const r = await http.put<Record<string, unknown>>(`${API_PREFIX}/sessions/${sessionId}/permission-mode`, { mode });
      const meta = emptySessionMeta(String(r.id ?? sessionId), {
        source: String(r.source ?? 'desktop'),
        model: String(r.model ?? ''),
        title: String(r.title ?? 'New Session'),
        started_at: String(r.started_at ?? new Date().toISOString()),
        message_count: Number(r.message_count ?? 0),
        cwd: (r.cwd as string) ?? null,
        archived: Boolean(r.archived),
        archivedAt: typeof r.archivedAt === 'number' ? r.archivedAt : null,
        permissionMode: permissionModeOf(r.permissionMode),
        runtime: sessionRuntimeOf(r.runtime),
      });
      return {
        ...meta,
        appliedToActiveTurn: Boolean(r.appliedToActiveTurn),
        appliesNextTurn: Boolean(r.appliesNextTurn),
      };
    },

    updateRuntime: async (
      sessionId: string,
      patch: Partial<SessionRuntime>,
    ): Promise<SessionRuntimeUpdateResult> => {
      const r = await http.patch<Record<string, unknown>>(`${API_PREFIX}/sessions/${sessionId}/runtime`, patch);
      return mapRuntimeUpdate(sessionId, r);
    },

    branch: async (sessionId: string): Promise<SessionMeta> => {
      const r = await http.post<Record<string, unknown>>(`${API_PREFIX}/sessions/${sessionId}/branch`, {});
      const sid = String(r.session_id ?? r.id ?? '');
      deps.rememberSession(sid, 0);
      return emptySessionMeta(sid, {
        model: String(r.model ?? ''),
        started_at: String(r.started_at ?? new Date().toISOString()),
        parent_session_id: sessionId,
        cwd: (r.cwd as string) ?? null,
        archived: Boolean(r.archived),
        archivedAt: typeof r.archivedAt === 'number' ? r.archivedAt : null,
        permissionMode: permissionModeOf(r.permissionMode),
        runtime: sessionRuntimeOf(r.runtime),
      });
    },

    resume: async (_sessionId: string): Promise<void> => undefined,

    interrupt: async (sessionId: string): Promise<void> => {
      await http.post(`${API_PREFIX}/sessions/${sessionId}/interrupt`, {});
    },

    steer: async (sessionId: string, text: string): Promise<SessionSteerResponse> => {
      const r = await http.post<Record<string, unknown>>(`${API_PREFIX}/sessions/${sessionId}/steer`, { text });
      return {
        status: r.status === 'queued' || r.status === 'rejected' ? r.status : undefined,
        text: typeof r.text === 'string' ? r.text : undefined,
      };
    },

    undo: async (sessionId: string): Promise<{ removed: number }> => {
      const r = await http.post<Record<string, unknown>>(`${API_PREFIX}/sessions/${sessionId}/undo`, {});
      return { removed: Number(r.removed ?? 0) };
    },

    messages: async (sessionId: string): Promise<SessionMessage[]> => {
      const rows = await http.get<Array<Record<string, unknown>>>(`${API_PREFIX}/sessions/${sessionId}/messages`);
      return deps.aggregateEventRows(sessionId, rows);
    },

    transcript: async (sessionId: string): Promise<SessionTranscript> => {
      const transcript = await http.get<SessionTranscript>(`${API_PREFIX}/sessions/${sessionId}/transcript`);
      deps.rememberSession(sessionId);
      if (transcript.max_seq > deps.getLastSeq(sessionId)) {
        deps.updateLastSeq(sessionId, transcript.max_seq);
      }
      return transcript;
    },
  };
}

export function makePromptGateway(http: HttpClient): GatewayAdapter['prompt'] {
  return {
    execute: async (params) => {
      const body: Record<string, unknown> = {
        message: params.message,
        session_id: params.session_id,
        provider: params.provider,
        model: params.model,
      };
      if (params.context !== undefined) body.context = params.context;
      if (params.slash_command !== undefined) body.slash_command = params.slash_command;
      if (params.display_parts !== undefined) body.display_parts = params.display_parts;
      return http.post(`${API_PREFIX}/prompt/execute`, body);
    },
  };
}

export function makeImageGateway(http: HttpClient): GatewayAdapter['image'] {
  return {
    attach: async (params) => http.post(`${API_PREFIX}/image/attach`, params),
    detach: async (params) => http.post(`${API_PREFIX}/image/detach`, params),
  };
}

export function makeSessionProviderSetter(http: HttpClient): GatewayAdapter['setSessionProvider'] {
  return async (sessionId: string, provider: string, model?: string): Promise<void> => {
    await http.put(`${API_PREFIX}/sessions/${sessionId}/provider`, {
      provider,
      model,
    });
  };
}
