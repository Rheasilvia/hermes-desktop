/**
 * Gateway adapter types for the Hermes Desktop app.
 * Defines the contract between the UI and the Hermes gateway.
 */

import type {
  SessionMeta,
  SessionMessage,
  SessionUsage,
  SessionListItem,
  Session,
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
  ContextFile,
  MemoryEntry,
  GatewayReadyPayload,
  SessionInfoPayload,
  SessionUsagePayload,
  MessageStartPayload,
  MessageDeltaPayload,
  MessageCompletePayload,
  MessageStatusPayload,
  ThinkingDeltaPayload,
  ReasoningDeltaPayload,
  ReasoningAvailablePayload,
  StatusUpdatePayload,
  ToolStartPayload,
  ToolProgressPayload,
  ToolCompletePayload,
  ToolGeneratingPayload,
  ToolErrorPayload,
  ApprovalRequestPayload,
  ClarifyRequestPayload,
  SudoRequestPayload,
  SecretRequestPayload,
  BackgroundCompletePayload,
  BtwCompletePayload,
  ErrorPayload,
  GatewayStderrPayload,
  ProtocolErrorPayload,
  SessionTitleUpdatePayload,
  SubagentStartPayload,
  SubagentProgressPayload,
  SubagentCompletePayload,
  SubagentToolPayload,
  SubagentErrorPayload,
} from '@/types/index.js';

/** Connection state of the gateway adapter. */
export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

/** All gateway event types mapped to their payloads. */
export interface GatewayEventMap {
  'gateway.ready': GatewayReadyPayload;
  'session.info': SessionInfoPayload;
  'message.start': MessageStartPayload;
  'message.delta': MessageDeltaPayload;
  'message.complete': MessageCompletePayload;
  'thinking.delta': ThinkingDeltaPayload;
  'reasoning.delta': ReasoningDeltaPayload;
  'reasoning.available': ReasoningAvailablePayload;
  'status.update': StatusUpdatePayload;
  'tool.start': ToolStartPayload;
  'tool.progress': ToolProgressPayload;
  'tool.complete': ToolCompletePayload;
  'tool.generating': ToolGeneratingPayload;
  'tool.error': ToolErrorPayload;
  'approval.request': ApprovalRequestPayload;
  'clarify.request': ClarifyRequestPayload;
  'sudo.request': SudoRequestPayload;
  'secret.request': SecretRequestPayload;
  'background.complete': BackgroundCompletePayload;
  'btw.complete': BtwCompletePayload;
  'error': ErrorPayload;
  'gateway.stderr': GatewayStderrPayload;
  'gateway.protocol_error': ProtocolErrorPayload;
  'session.title_update': SessionTitleUpdatePayload;
  'subagent.start': SubagentStartPayload;
  'subagent.progress': SubagentProgressPayload;
  'subagent.complete': SubagentCompletePayload;
  'subagent.tool': SubagentToolPayload;
  'subagent.error': SubagentErrorPayload;
}

/** Typed event emitter interface for gateway events. */
export interface GatewayEventEmitter {
  on<K extends keyof GatewayEventMap>(
    event: K,
    handler: (payload: GatewayEventMap[K]) => void
  ): void;
  off<K extends keyof GatewayEventMap>(
    event: K,
    handler: (payload: GatewayEventMap[K]) => void
  ): void;
}

/** Session method group. */
export interface SessionMethods {
  list(): Promise<SessionListItem[]>;
  info(sessionId: string): Promise<SessionInfoPayload>;
  create(params: { model?: string; provider?: string; system_prompt?: string; workspace_path?: string }): Promise<SessionMeta>;
  delete(sessionId: string): Promise<void>;
  rename(sessionId: string, title: string): Promise<void>;
  updateWorkspace(sessionId: string, workspacePath: string): Promise<void>;
  branch(sessionId: string): Promise<SessionMeta>;
  resume(sessionId: string): Promise<void>;
  interrupt(sessionId: string): Promise<void>;
  messages(sessionId: string): Promise<SessionMessage[]>;
}

/** Prompt method group. */
export interface PromptMethods {
  execute(params: { message: string; session_id?: string; provider?: string; model?: string }): Promise<void>;
}

/** Config method group. */
export interface ConfigMethods {
  get(): Promise<HermesConfig>;
  getMtime(): Promise<number>;
  set(input: ConfigSetInput): Promise<void>;
}

/** Tools method group. */
export interface ToolsMethods {
  list(): Promise<ToolEntry[]>;
  reload(): Promise<void>;
}

export interface ModelOptionsResult {
  providers: import('@/types/index.js').ProviderEntry[];
  model: string;
  provider: string;
}

export interface UpsertProviderInput {
  name: string;
  is_builtin: boolean;
  base_url?: string;
  api_key?: string;
  api_key_env?: string;
  display_name?: string;
  source?: 'desktop' | 'tui' | 'cli';
}

export interface DeleteProviderInput {
  name: string;
  is_builtin: boolean;
  source?: 'desktop' | 'tui' | 'cli';
}

export interface ConfigSetInput {
  key: string;
  value: unknown;
  source?: 'desktop' | 'tui' | 'cli';
}

/** Model method group. */
export interface ModelMethods {
  options(sessionId?: string): Promise<ModelOptionsResult>;
}

/** Provider method group. */
export interface ProviderMethods {
  upsert(input: UpsertProviderInput): Promise<{ name: string }>;
  delete(input: DeleteProviderInput): Promise<{ ok: boolean }>;
}

/** Approval method group. */
export interface ApprovalMethods {
  respond(params: { session_id: string; command: string; choice: 'once' | 'session' | 'always' | 'deny' }): Promise<void>;
}

/** Clarify method group. */
export interface ClarifyMethods {
  respond(params: { session_id: string; request_id: string; answer: string }): Promise<void>;
}

/** Sudo method group. */
export interface SudoMethods {
  respond(params: { request_id: string; password: string }): Promise<void>;
}

/** Secret method group. */
export interface SecretMethods {
  respond(params: { request_id: string; value: string }): Promise<void>;
}

/** Cron method group. */
export interface CronMethods {
  list(): Promise<CronJob[]>;
  create(job: CreateCronJobParams): Promise<CronJob>;
  update(id: string, job: UpdateCronJobParams): Promise<CronJob>;
  delete(id: string): Promise<void>;
}

/** MCP method group. */
export interface McpMethods {
  list(): Promise<McpServer[]>;
  add(server: Partial<McpServer>): Promise<McpServer>;
  remove(name: string): Promise<void>;
  tools(serverName: string): Promise<McpTool[]>;
}

/** Memory method group. Real backend at `/desktop/api/memory/*`. */
export interface MemoryMethods {
  /** Distinct workspaces from the sessions table, ordered by recency. */
  projects(): Promise<MemoryProject[]>;
  /**
   * Whitelisted file metadata for the given scope.
   * `workspace` is required when `scope === 'project'`.
   */
  files(scope: MemoryScope, workspace?: string): Promise<MemoryFile[]>;
  /** Read a single whitelisted file with content. */
  readFile(
    scope: MemoryScope,
    name: WellKnownMemoryName,
    workspace?: string,
  ): Promise<MemoryFileWithContent>;
  /**
   * Atomic write. Pass the previously-read `modified_at` as `ifMatch` for
   * optimistic concurrency. Mismatch raises a 409 carrying the current
   * server-side content (caller can show a merge dialog).
   */
  writeFile(args: {
    scope: MemoryScope;
    name: WellKnownMemoryName;
    workspace?: string;
    content: string;
    ifMatch?: string;
  }): Promise<MemoryFileWithContent>;
  /**
   * Substring search across whitelisted files. Optional scope/workspace
   * narrowing.
   */
  search(
    query: string,
    opts?: { scope?: MemoryScope; workspace?: string },
  ): Promise<MemorySearchHit[]>;
}

/** A skill registered in the agent, with category and enabled state. */
export interface SkillInfo {
  name: string;
  description: string;
  category: string;
  enabled: boolean;
  icon?: string;
}

/** A toolset card from the toolset registry. */
export interface SkillsToolset {
  name: string;
  label: string;
  description: string;
  enabled: boolean;
  configured: boolean;
  tools: string[];
}

/** Skills method group. */
export interface SkillsMethods {
  list(): Promise<SkillInfo[]>;
}

/** Slash command completion method group. */
export interface CompleteMethods {
  slash(params: { partial: string }): Promise<{ command: string; description: string; category?: string; icon?: string }[]>;
  path(params: { partial: string }): Promise<string[]>;
}

/** Slash execution method group. */
export interface SlashMethods {
  exec(params: { command: string; args?: string }): Promise<void>;
}

/** Command dispatch method group. */
export interface CommandMethods {
  dispatch(params: { command: string; args?: string }): Promise<void>;
}

/** Delegation method group. */
export interface DelegationMethods {
  status(): Promise<{ active: import('@/types/index.js').SubagentRecord[]; paused: boolean; max_spawn_depth: number }>;
  pause(params: { paused: boolean }): Promise<{ paused: boolean }>;
}

/** Subagent method group. */
export interface SubagentMethods {
  interrupt(params: { subagent_id: string }): Promise<{ found: boolean; subagent_id: string }>;
}

/** The full Gateway adapter interface — all method groups + events + lifecycle. */
export interface GatewayAdapter extends GatewayEventEmitter {
  // Method groups
  readonly session: SessionMethods;
  readonly prompt: PromptMethods;
  readonly config: ConfigMethods;
  readonly tools: ToolsMethods;
  readonly model: ModelMethods;
  readonly provider: ProviderMethods;
  readonly approval: ApprovalMethods;
  readonly clarify: ClarifyMethods;
  readonly sudo: SudoMethods;
  readonly secret: SecretMethods;
  readonly cron: CronMethods;
  readonly mcp: McpMethods;
  readonly memory: MemoryMethods;
  readonly skills: SkillsMethods;
  readonly complete: CompleteMethods;
  readonly slash: SlashMethods;
  readonly command: CommandMethods;
  readonly delegation: DelegationMethods;
  readonly subagent: SubagentMethods;

  /** Set the provider and model for a specific session */
  setSessionProvider(sessionId: string, provider: string, model?: string): Promise<void>;

  // Lifecycle
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  getConnectionState(): ConnectionState;
}

export type { SessionListItem, SessionMessage, SessionMeta, SessionInfoPayload, HermesConfig, ToolEntry, ModelOption, CronJob, CreateCronJobParams, UpdateCronJobParams, McpServer, McpTool, MemoryFile, MemoryFileWithContent, MemoryProject, MemorySearchHit, MemoryScope, WellKnownMemoryName, ContextFile, MemoryEntry, SessionUsagePayload } from '@/types/index.js';

/** Factory options for creating a gateway adapter. */
export interface GatewayAdapterOptions {
  // Reserved for future options (e.g. timeout, retry policy)
}
