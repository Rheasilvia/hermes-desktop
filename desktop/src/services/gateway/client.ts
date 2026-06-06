/**
 * GatewayClient — wraps a Transport and exposes typed gateway methods + events.
 */

import type { Transport } from './transport.js';
import type {
  GatewayAdapter,
  ConnectionState,
  GatewayEventMap,
  SessionListItem,
  SessionMessage,
  SessionTranscript,
  PromptExecuteResult,
  SessionMeta,
  SessionInfoPayload,
  HermesConfig,
  ToolEntry,
  ModelOption,
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
  ConfigSetInput,
  UpsertProviderInput,
  DeleteProviderInput,
} from './types.js';

type EventHandler<K extends keyof GatewayEventMap> = (payload: GatewayEventMap[K]) => void;

export class GatewayClient {
  private transport: Transport;
  private state: ConnectionState = 'disconnected';
  private handlers: Map<string, Set<EventHandler<keyof GatewayEventMap>>> = new Map();
  private messageHandler: ((event: Record<string, unknown>) => void) | null = null;

  constructor(transport: Transport) {
    this.transport = transport;
  }

  getConnectionState(): ConnectionState {
    return this.state;
  }

  private setState(state: ConnectionState): void {
    this.state = state;
  }

  private emit<K extends keyof GatewayEventMap>(event: K, payload: GatewayEventMap[K]): void {
    const handlers = this.handlers.get(event);
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(payload);
        } catch {
          // swallow handler errors
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

  private async call<T>(method: string, params?: Record<string, unknown>): Promise<T> {
    return this.transport.send(method, params) as Promise<T>;
  }

  async connect(): Promise<void> {
    this.setState('connecting');
    this.messageHandler = (event: Record<string, unknown>) => {
      const type = event.type as keyof GatewayEventMap;
      if (type && this.handlers.has(type)) {
        this.emit(type, event.payload as GatewayEventMap[typeof type]);
      }
    };
    this.transport.onMessage(this.messageHandler);
    this.setState('connected');
  }

  async disconnect(): Promise<void> {
    this.transport.close();
    this.messageHandler = null;
    this.handlers.clear();
    this.setState('disconnected');
  }

  session = {
    list: (): Promise<SessionListItem[]> => this.call('session.list'),
    info: (sessionId: string): Promise<SessionInfoPayload> =>
      this.call('session.info', { session_id: sessionId }),
    create: (params: { model?: string; provider?: string; system_prompt?: string; cwd?: string }): Promise<SessionMeta> =>
      this.call('session.create', params),
    delete: (sessionId: string): Promise<void> =>
      this.call('session.delete', { session_id: sessionId }),
    rename: (sessionId: string, title: string): Promise<void> =>
      this.call('session.rename', { session_id: sessionId, title }),
    updateCwd: (sessionId: string, cwd: string): Promise<{ cwd: string }> =>
      this.call('session.cwd.set', { session_id: sessionId, cwd }),
    branch: (sessionId: string): Promise<SessionMeta> =>
      this.call('session.branch', { session_id: sessionId }),
    resume: (sessionId: string): Promise<void> =>
      this.call('session.resume', { session_id: sessionId }),
    interrupt: (): Promise<void> => this.call('session.interrupt'),
    undo: (sessionId: string): Promise<{ removed: number }> =>
      this.call('session.undo', { session_id: sessionId }),
    messages: (sessionId: string): Promise<SessionMessage[]> =>
      this.call('session.messages', { session_id: sessionId }),
    transcript: (sessionId: string): Promise<SessionTranscript> =>
      this.call('session.transcript', { session_id: sessionId }),
  };

  prompt = {
    execute: (params: {
      message: string; session_id?: string; provider?: string; model?: string;
      context?: string; slash_command?: { command: string; args: string };
    }): Promise<PromptExecuteResult> =>
      this.call('prompt.execute', params),
  };

  config = {
    get: async (): Promise<HermesConfig> => {
      const result = await this.call<{ config: HermesConfig }>('config.get', { key: 'full' });
      return result.config;
    },
    getMtime: async (): Promise<number> => {
      const result = await this.call<{ mtime: number }>('config.get', { key: 'mtime' });
      return result.mtime ?? 0;
    },
    set: (input: ConfigSetInput): Promise<void> =>
      this.call('config.set', { key: input.key, value: input.value, source: input.source ?? 'desktop' }),
  };

  tools = {
    list: (): Promise<ToolEntry[]> => this.call('tools.list'),
    reload: (): Promise<void> => this.call('tools.reload'),
  };

  model = {
    options: (sessionId?: string): Promise<import('./types.js').ModelOptionsResult> =>
      this.call('model.options', { session_id: sessionId ?? '' }),
  };

  provider = {
    upsert: (input: UpsertProviderInput): Promise<{ name: string }> =>
      this.call('provider.upsert', input as unknown as Record<string, unknown>),
    delete: (input: DeleteProviderInput): Promise<{ ok: boolean }> =>
      this.call('provider.delete', input as unknown as Record<string, unknown>),
  };

  approval = {
    respond: (params: {
      session_id: string;
      command: string;
      choice: 'once' | 'session' | 'always' | 'deny';
    }): Promise<void> => this.call('approval.respond', params),
  };

  clarify = {
    respond: (params: { session_id: string; request_id: string; answer: string }): Promise<void> =>
      this.call('clarify.respond', params),
  };

  sudo = {
    respond: (params: { request_id: string; password: string }): Promise<void> =>
      this.call('sudo.respond', params),
  };

  secret = {
    respond: (params: { request_id: string; value: string }): Promise<void> =>
      this.call('secret.respond', params),
  };

  cron = {
    list: (): Promise<CronJob[]> => this.call('cron.list'),
    create: (job: CreateCronJobParams): Promise<CronJob> => this.call('cron.create', job as unknown as Record<string, unknown>),
    update: (id: string, job: UpdateCronJobParams): Promise<CronJob> =>
      this.call('cron.update', { id, ...job }),
    delete: (id: string): Promise<void> => this.call('cron.delete', { id }),
  };

  mcp = {
    list: (): Promise<McpServer[]> => this.call('mcp.list'),
    add: (server: Partial<McpServer>): Promise<McpServer> => this.call('mcp.add', server),
    remove: (name: string): Promise<void> => this.call('mcp.remove', { name }),
    tools: (serverName: string): Promise<McpTool[]> =>
      this.call('mcp.tools', { server_name: serverName }),
  };

  memory = {
    projects: (): Promise<MemoryProject[]> => this.call('memory.projects'),
    files: (
      scope: MemoryScope,
      workspace?: string,
    ): Promise<MemoryFile[]> =>
      this.call('memory.files', { scope, workspace }),
    readFile: (
      scope: MemoryScope,
      name: WellKnownMemoryName,
      workspace?: string,
    ): Promise<MemoryFileWithContent> =>
      this.call('memory.read_file', { scope, name, workspace }),
    writeFile: (args: {
      scope: MemoryScope;
      name: WellKnownMemoryName;
      workspace?: string;
      content: string;
      ifMatch?: string;
    }): Promise<MemoryFileWithContent> =>
      this.call('memory.write_file', {
        scope: args.scope,
        name: args.name,
        workspace: args.workspace,
        content: args.content,
        if_match: args.ifMatch,
      }),
    search: (
      query: string,
      opts?: { scope?: MemoryScope; workspace?: string },
    ): Promise<MemorySearchHit[]> =>
      this.call('memory.search', {
        query,
        scope: opts?.scope,
        workspace: opts?.workspace,
      }),
  };

  skills = {
    list: (): Promise<import('./types.js').SkillInfo[]> => this.call('skills.list'),
  };

  complete = {
    slash: (params: { partial: string }): Promise<{ command: string; description: string }[]> =>
      this.call('complete.slash', params),
    path: (params: { partial: string }): Promise<string[]> => this.call('complete.path', params),
  };

  slash = {
    exec: (params: { command: string; args?: string }): Promise<void> =>
      this.call('slash.exec', params),
  };

  command = {
    dispatch: (params: { command: string; args?: string }): Promise<void> =>
      this.call('command.dispatch', params),
  };
}
