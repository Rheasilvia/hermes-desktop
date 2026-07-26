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
  SessionRewindResult,
  SessionTranscript,
  PromptExecuteResult,
  CommandResult,
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
  CompletionEntry,
  WorkspaceChildrenResult,
  WorkspaceFileResult,
  GitDiffResult,
  GitBranchInfo,
  ReviewCommitMessageResult,
  ReviewFilesResult,
  ReviewOkResult,
  ReviewPrResult,
  ReviewShipInfoResult,
  BranchListResult,
  ProjectEntry,
  ProjectListResult,
  WorktreeListResult,
  SessionSteerResponse,
} from './types.js';
import type { UserDisplayPart } from '@/features/conversation/display-parts.js';

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
    list: (options?: { archived?: import('./types.js').SessionArchiveFilter }): Promise<SessionListItem[]> =>
      this.call('session.list', options ?? {}),
    info: (sessionId: string): Promise<SessionInfoPayload> =>
      this.call('session.info', { session_id: sessionId }),
    create: (params: { model?: string; provider?: string; system_prompt?: string; cwd?: string }): Promise<SessionMeta> =>
      this.call('session.create', params),
    delete: (sessionId: string): Promise<void> =>
      this.call('session.delete', { session_id: sessionId }),
    rename: (sessionId: string, title: string): Promise<void> =>
      this.call('session.rename', { session_id: sessionId, title }),
    setArchived: (sessionId: string, archived: boolean): Promise<{ archived: boolean; archivedAt?: number | null }> =>
      this.call('session.archived.set', { session_id: sessionId, archived }),
    updateCwd: (sessionId: string, cwd: string): Promise<{ cwd: string }> =>
      this.call('session.cwd.set', { session_id: sessionId, cwd }),
    setPermissionMode: (sessionId: string, mode: SessionMeta['permissionMode']) =>
      this.call('session.permission_mode.set', { session_id: sessionId, mode }),
    updateRuntime: (sessionId: string, patch: Partial<import('./types.js').SessionRuntime>) =>
      this.call('session.runtime.update', { session_id: sessionId, ...patch }),
    branch: (sessionId: string): Promise<SessionMeta> =>
      this.call('session.branch', { session_id: sessionId }),
    resume: (sessionId: string): Promise<void> =>
      this.call('session.resume', { session_id: sessionId }),
    interrupt: (): Promise<void> => this.call('session.interrupt'),
    steer: (sessionId: string, text: string): Promise<SessionSteerResponse> =>
      this.call('session.steer', { session_id: sessionId, text }),
    undo: (sessionId: string): Promise<{ removed: number }> =>
      this.call('session.undo', { session_id: sessionId }),
    rewindToTurn: (sessionId: string, turnId: string): Promise<SessionRewindResult> =>
      this.call('session.rewind_to_turn', { session_id: sessionId, turn_id: turnId }),
    messages: (sessionId: string): Promise<SessionMessage[]> =>
      this.call('session.messages', { session_id: sessionId }),
    transcript: (sessionId: string): Promise<SessionTranscript> =>
      this.call('session.transcript', { session_id: sessionId }),
  };

  prompt = {
    execute: (params: {
      message: string; session_id?: string; provider?: string; model?: string;
      context?: string; slash_command?: { command: string; args: string }; display_parts?: UserDisplayPart[];
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

  userInput = {
    respond: (params: { session_id: string; request_id: string; answers: import('./types.js').UserInputAnswersPayload }): Promise<void> =>
      this.call('user_input.respond', params),
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

  private normalizeCompletionEntries(result: unknown): CompletionEntry[] {
    const items = result && typeof result === 'object' && 'items' in result
      ? (result as { items?: unknown }).items
      : result;
    if (!Array.isArray(items)) return [];
    return items
      .filter((item): item is CompletionEntry =>
        Boolean(item && typeof item === 'object' && typeof (item as { text?: unknown }).text === 'string'))
      .map((item) => ({
        text: item.text,
        display: item.display,
        meta: item.meta,
      }));
  }

  complete = {
    slash: (params: { partial: string }): Promise<{ command: string; description: string }[]> =>
      this.call('complete.slash', params),
    path: async (params: { partial: string; sessionId: string }): Promise<CompletionEntry[]> => {
      const payload: Record<string, unknown> = {
        word: params.partial,
        session_id: params.sessionId,
      };
      const result = await this.call('complete.path', payload);
      return this.normalizeCompletionEntries(result);
    },
  };

  workspace = {
    children: (sessionId: string, path: string): Promise<WorkspaceChildrenResult> =>
      this.call('workspace.children', { session_id: sessionId, path }),
    readFile: (sessionId: string, path: string): Promise<WorkspaceFileResult> =>
      this.call('workspace.file', { session_id: sessionId, path }),
    writeFile: (
      sessionId: string,
      input: { path: string; content: string; expectedMtime?: number; expectedSize?: number },
    ): Promise<WorkspaceFileResult> =>
      this.call('workspace.file.write', {
        session_id: sessionId,
        path: input.path,
        content: input.content,
        expected_mtime: input.expectedMtime,
        expected_size: input.expectedSize,
      }),
    reveal: (sessionId: string, path: string): Promise<void> =>
      this.call('workspace.reveal', { session_id: sessionId, path }),
  };

  git = {
    diff: (sessionId: string): Promise<GitDiffResult> =>
      this.call('git.diff', { session_id: sessionId }),
    branches: (sessionId: string): Promise<GitBranchInfo> =>
      this.call('git.branches', { session_id: sessionId }),
    checkout: (sessionId: string, branch: string): Promise<void> =>
      this.call('git.checkout', { session_id: sessionId, branch }),
  };

  review = {
    files: (sessionId: string): Promise<ReviewFilesResult> =>
      this.call('review.files', { session_id: sessionId }),
    diff: (sessionId: string, input: { path?: string | null; staged?: boolean } = {}): Promise<GitDiffResult> =>
      this.call('review.diff', { session_id: sessionId, path: input.path ?? null, staged: input.staged ?? false }),
    stage: (sessionId: string, paths: string[]): Promise<ReviewOkResult> =>
      this.call('review.stage', { session_id: sessionId, paths }),
    unstage: (sessionId: string, paths: string[]): Promise<ReviewOkResult> =>
      this.call('review.unstage', { session_id: sessionId, paths }),
    revert: (sessionId: string, paths: string[]): Promise<ReviewOkResult> =>
      this.call('review.revert', { session_id: sessionId, paths }),
    commit: (sessionId: string, message: string): Promise<ReviewOkResult> =>
      this.call('review.commit', { session_id: sessionId, message }),
    push: (sessionId: string): Promise<ReviewOkResult> =>
      this.call('review.push', { session_id: sessionId }),
    createPr: (sessionId: string): Promise<ReviewPrResult> =>
      this.call('review.pr', { session_id: sessionId }),
    generateCommitMessage: (sessionId: string, avoid?: string): Promise<ReviewCommitMessageResult> =>
      this.call('review.commit_message', { session_id: sessionId, avoid }),
    defaultBranch: (sessionId: string): Promise<string | null> =>
      this.call('review.default_branch', { session_id: sessionId }),
    shipInfo: (sessionId: string): Promise<ReviewShipInfoResult> =>
      this.call('review.ship_info', { session_id: sessionId }),
  };

  projects = {
    list: (): Promise<ProjectListResult> =>
      this.call('projects.list'),
    upsert: (path: string, name?: string): Promise<ProjectEntry> =>
      this.call('projects.upsert', { path, name }),
    setActive: (path: string | null): Promise<ProjectListResult> =>
      this.call('projects.active.set', { path }),
    worktrees: (repoPath: string): Promise<WorktreeListResult> =>
      this.call('projects.worktrees', { repo_path: repoPath }),
    addWorktree: (input: { repoPath: string; path: string; branch: string; createBranch?: boolean }): Promise<ReviewOkResult> =>
      this.call('projects.worktrees.add', {
        repo_path: input.repoPath,
        path: input.path,
        branch: input.branch,
        create_branch: input.createBranch ?? false,
      }),
    removeWorktree: (input: { repoPath: string; path: string }): Promise<ReviewOkResult> =>
      this.call('projects.worktrees.remove', { repo_path: input.repoPath, path: input.path }),
    branches: (repoPath: string): Promise<BranchListResult> =>
      this.call('projects.branches', { repo_path: repoPath }),
    switchBranch: (input: { path: string; branch: string }): Promise<ReviewOkResult> =>
      this.call('projects.branches.switch', input),
  };

  slash = {
    exec: (params: { command: string; args?: string; raw?: string; session_id?: string }): Promise<CommandResult> =>
      this.call('slash.exec', params),
    resolvePrompt: (params: { command: string; args?: string; raw?: string; session_id?: string }): Promise<CommandResult> =>
      this.call('slash.resolve_prompt', params),
  };

  command = {
    dispatch: (params: { command: string; args?: string; raw?: string; session_id?: string }): Promise<CommandResult> =>
      this.call('command.dispatch', params),
  };
}
