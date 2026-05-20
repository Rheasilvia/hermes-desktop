/**
 * TypeScript types matching hermes-agent Python data structures.
 * Barrel export for all type modules.
 */

// Message types
export type { Role, ToolCall, ToolCallFunction, Usage, Message, ReasoningItem, MessageDelta, MessageComplete, MessageStatus } from './message.js';

// Session types
export type { SessionMeta, SessionMessage, SessionUsage, SessionInfo, McpServerStatus, SessionListItem, Session } from './session.js';

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

// Gateway types
export type {
  RpcRequest, RpcResponse, RpcError, RpcResult, GatewayEvent, GatewayMethod,
  GatewayReadyPayload, GatewaySkin, SessionInfoPayload, SessionUsagePayload,
  MessageStartPayload, MessageDeltaPayload, MessageCompletePayload, MessageStatusPayload,
  ThinkingDeltaPayload, ReasoningDeltaPayload, ReasoningAvailablePayload,
  StatusUpdatePayload, ToolStartPayload, ToolProgressPayload, ToolCompletePayload,
  ToolGeneratingPayload, ToolErrorPayload, ApprovalRequestPayload, ClarifyRequestPayload,
  SudoRequestPayload, SecretRequestPayload, BackgroundCompletePayload, BtwCompletePayload,
  ErrorPayload, GatewayStderrPayload, ProtocolErrorPayload
} from './gateway.js';
export { SESSION_METHODS, PROMPT_METHODS, CONFIG_METHODS, TOOLS_METHODS, MODEL_METHODS, APPROVAL_METHODS, CLARIFY_METHODS, SUDO_METHODS, SECRET_METHODS } from './gateway.js';

// Model types
export type { ProviderEntry, ModelOption } from './model.js';

// Cron types
export type { ScheduleKind, Schedule, Repeat, DeliveryKind, Delivery, CronJob, CreateCronJobParams, UpdateCronJobParams } from './cron.js';

// Memory types
export type { MemoryFile, ContextFile, MemoryEntry, UserProfile } from './memory.js';

// MCP types
export type { McpTransport, McpAuthType, McpServer, McpOAuthConfig, McpSamplingConfig, McpTool, McpInputSchema, McpSchemaProperty, McpConnectionStatus } from './mcp.js';

// Diff types
export type { LineKind, DiffLine, DiffHunk, FileStatus, DiffFile, DiffSummary, GitDiffResult } from './diff.js';

// Analytics types
export type {
  ModelCapabilities,
  ModelUsageStat,
  UsageTotals,
  ModelAnalyticsResponse,
  AnalyticsPeriod,
} from './analytics.js';

// DB row types (snake_case, mirrors SQLite columns)
export type { DbSession, DbDesktopSessionMeta } from './db/session.js';
export type { DbMessage } from './db/message.js';

// Domain model types (camelCase, business logic)
export type { ConversationSession, SessionUsage as ConversationSessionUsage } from './domain/session.js';
export type { ConversationMessage, ParsedToolCall, MessageAttachment } from './domain/message.js';

// UI rendering types
export type {
  MessageBlock, TextBlock, CodeBlock, ReasoningBlock,
  ToolCallBlock, RichContentBlock, RichContentKind, AttachmentBlock,
} from './ui/blocks.js';
export type {
  ChartData, ChartDataset, WebSearchResult, WebSearchResultItem,
  ImageContent, ImageTextContent, FileContent,
} from './ui/rich.js';
export type { RenderedMessage, MessageAction } from './ui/message.js';
export type { TurnStatus, LiveTurnState, LiveToolCall, PendingApproval, PendingClarify, MemoryContextItem } from './ui/turn.js';
export type { ToolCallRow } from './ui/tool-presentation.js';
