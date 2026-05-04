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
  ContextFile,
  MemoryEntry,
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
    create: (params: { model?: string; system_prompt?: string }): Promise<SessionMeta> =>
      this.call('session.create', params),
    delete: (sessionId: string): Promise<void> =>
      this.call('session.delete', { session_id: sessionId }),
    branch: (sessionId: string): Promise<SessionMeta> =>
      this.call('session.branch', { session_id: sessionId }),
    resume: (sessionId: string): Promise<void> =>
      this.call('session.resume', { session_id: sessionId }),
    interrupt: (): Promise<void> => this.call('session.interrupt'),
    messages: (sessionId: string): Promise<SessionMessage[]> =>
      this.call('session.messages', { session_id: sessionId }),
  };

  prompt = {
    execute: (params: { message: string; session_id?: string }): Promise<void> =>
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
      command: string;
      choice: 'once' | 'session' | 'always' | 'deny';
    }): Promise<void> => this.call('approval.respond', params),
  };

  clarify = {
    respond: (params: { request_id: string; answer: string }): Promise<void> =>
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
    files: (): Promise<MemoryFile[]> => this.call('memory.files'),
    contextFiles: (): Promise<ContextFile[]> => this.call('memory.context_files'),
    search: (query: string): Promise<MemoryEntry[]> =>
      this.call('memory.search', { query }),
  };

  skills = {
    list: (): Promise<{ name: string; description: string }[]> => this.call('skills.list'),
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
