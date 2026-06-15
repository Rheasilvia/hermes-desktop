/**
 * TypeScript types matching hermes-agent Python data structures.
 * Barrel export for all type modules.
 *
 * Wire types (HTTP/SSE/Rust payload shapes) are now under @/types/wire/*.
 * Prefer direct wire imports for new code; this barrel remains for backwards compat.
 */

// Wire types — HTTP/SSE/Rust payload shapes (prefer @/types/wire/* for new code)
export * from './wire/index.js';

// Message types
export type { Role, ToolCall, ToolCallFunction, Usage, Message, ReasoningItem, MessageDelta, MessageComplete, MessageStatus } from './message.js';

// Tool types
export type { ToolParameter, ToolSchema, ToolEnvVar, ToolEntry, ToolsetInfo, ActiveTool, ToolStartEvent, ToolProgressEvent, ToolCompleteEvent, ToolGeneratingEvent } from './tool.js';

// Config types
export type {
  ModelConfig, ProviderConfig, ToolsetsConfig, AgentConfig, TerminalConfig, BrowserConfig,
  CheckpointsConfig, CompressionConfig, BedrockConfig, AuxiliaryConfig, DisplayConfig,
  DashboardConfig, PrivacyConfig, TtsConfig, SttConfig, VoiceConfig, HumanDelayConfig,
  ContextConfig, MemoryConfig, DelegationConfig, PrefillMessagesConfig, SkillsConfig,
  HonchoConfig, TimezoneConfig, CronConfig, CodeExecutionConfig, LoggingConfig,
  NetworkConfig, FileReadConfig, DiscordConfig, WhatsAppConfig, TelegramConfig,
  SlackConfig, MattermostConfig, ApprovalsConfig, CommandAllowlistConfig,
  QuickCommandsConfig, PersonalitiesConfig, SecurityConfig, HermesConfig
} from './config.js';

// Command types
export type { CommandCategory, CommandSubcommand, CommandDef, CommandCatalog } from './command.js';

// Cron types
export type { ScheduleKind, Schedule, Repeat, DeliveryKind, Delivery, CronJob, CreateCronJobParams, UpdateCronJobParams } from './cron.js';

// Memory types
export type {
  MemoryFile,
  MemoryFileWithContent,
  MemorySearchHit,
  MemoryProject,
  MemoryScope,
  WellKnownMemoryName,
  ContextFile,
  MemoryEntry,
} from './memory.js';

// MCP types
export type { McpTransport, McpAuthType, McpServer, McpOAuthConfig, McpSamplingConfig, McpTool, McpInputSchema, McpSchemaProperty, McpConnectionStatus } from './mcp.js';

// Workspace tree types
export type { WorkspaceTreeNodeKind, WorkspaceTreeNode, WorkspaceChildrenResult, WorkspaceFileResult, WorkspaceTreeRow } from './workspace-tree.js';

// DB row types (snake_case, mirrors SQLite columns)
export type { DbSession, DbDesktopSessionMeta } from './db/session.js';
export type { DbMessage } from './db/message.js';

// Session wire/read-model types
export type {
  SessionMeta,
  DesktopPermissionMode,
  ReasoningEffort,
  SessionRuntime,
  SessionRuntimeUpdateResult,
  SessionMessage,
  SessionUsage,
  SessionInfo,
  McpServerStatus,
  SessionListItem,
  Session,
  SessionTranscript,
  TranscriptMessage,
  TranscriptLiveTurn,
  TranscriptTurnStatus,
} from './session.js';

// Domain model types (camelCase, business logic)
export type { ConversationSession, SessionUsage as ConversationSessionUsage } from './domain/session.js';
export type { ConversationMessage, ParsedToolCall, MessageAttachment } from './domain/message.js';

// UI rendering types
export type {
  MessageBlock, TextBlock, CodeBlock, ReasoningBlock,
  ToolCallBlock, RichContentBlock, RichContentKind, AttachmentBlock,
  TodoListBlock,
} from './ui/blocks.js';
export type {
  ChartData, ChartDataset, WebSearchResult, WebSearchResultItem,
  ImageContent, ImageTextContent, FileContent,
} from './ui/rich.js';
export type { RenderedMessage, MessageAction, MessageActionType } from './ui/message.js';
export type { TurnStatus, LiveTurnState, LiveToolCall, PendingPermission, PendingClarify, MemoryContextItem } from './ui/turn.js';
export type { ToolCallRow } from './ui/tool-presentation.js';
