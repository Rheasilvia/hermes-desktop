/**
 * Config types matching DEFAULT_CONFIG from hermes_cli/config.py.
 * @source hermes_cli/config.py
 */

/** Model configuration. */
export interface ModelConfig {
  provider?: string;
  model?: string;
  base_url?: string;
  api_key?: string;
}

/** Provider configuration. */
export interface ProviderConfig {
  provider: string;
  base_url?: string;
  api_key?: string;
  timeout?: number;
  max_retries?: number;
}

/** Toolsets configuration. */
export interface ToolsetsConfig {
  enabled?: string[];
  disabled?: string[];
}

/** Agent configuration. */
export interface AgentConfig {
  max_iterations?: number;
  save_trajectories?: boolean;
  system_prompt?: string;
}

/** Terminal backend configuration. */
export interface TerminalConfig {
  backend?: string;
  cwd?: string;
  docker_image?: string;
  ssh_host?: string;
}

/** Browser configuration. */
export interface BrowserConfig {
  provider?: string;
  viewport_width?: number;
  viewport_height?: number;
}

/** Checkpoints configuration. */
export interface CheckpointsConfig {
  enabled?: boolean;
  interval_minutes?: number;
}

/** Compression configuration. */
export interface CompressionConfig {
  enabled?: boolean;
  threshold_chars?: number;
}

/** Bedrock (AWS) configuration. */
export interface BedrockConfig {
  region?: string;
  profile?: string;
}

/** Auxiliary LLM configuration. */
export interface AuxiliaryConfig {
  provider?: string;
  model?: string;
}

/** Display configuration. */
export interface DisplayConfig {
  theme?: string;
  skin?: string;
  show_cost?: boolean;
  show_reasoning?: boolean;
  tool_progress_command?: string;
  background_process_notifications?: 'all' | 'result' | 'error' | 'off';
}

/** Dashboard configuration. */
export interface DashboardConfig {
  enabled?: boolean;
  port?: number;
}

/** Privacy configuration. */
export interface PrivacyConfig {
  dry_run?: boolean;
  approve_commands?: boolean;
}

/** TTS (Text-to-Speech) configuration. */
export interface TtsConfig {
  provider?: string;
  edge?: { voice?: string; [key: string]: unknown };
  elevenlabs?: { voice_id?: string; model_id?: string; [key: string]: unknown };
  openai?: { model?: string; voice?: string; [key: string]: unknown };
  xai?: { voice_id?: string; language?: string; [key: string]: unknown };
  minimax?: { model?: string; voice_id?: string; [key: string]: unknown };
  mistral?: { model?: string; voice_id?: string; [key: string]: unknown };
  gemini?: { model?: string; voice?: string; [key: string]: unknown };
  neutts?: { model?: string; device?: string; [key: string]: unknown };
  kittentts?: { model?: string; voice?: string; [key: string]: unknown };
  piper?: { voice?: string; [key: string]: unknown };
  [key: string]: unknown;
}

/** STT (Speech-to-Text) configuration. */
export interface SttConfig {
  enabled?: boolean;
  provider?: string;
  local?: { model?: string; language?: string; [key: string]: unknown };
  openai?: { model?: string; [key: string]: unknown };
  groq?: { model?: string; [key: string]: unknown };
  mistral?: { model?: string; [key: string]: unknown };
  elevenlabs?: {
    model_id?: string;
    language_code?: string;
    tag_audio_events?: boolean;
    diarize?: boolean;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/** Voice configuration. */
export interface VoiceConfig {
  record_key?: string;
  max_recording_seconds?: number;
  auto_tts?: boolean;
  beep_enabled?: boolean;
  silence_threshold?: number;
  silence_duration?: number;
  [key: string]: unknown;
}

/** Human delay configuration. */
export interface HumanDelayConfig {
  enabled?: boolean;
  min_ms?: number;
  max_ms?: number;
}

/** Context configuration. */
export interface ContextConfig {
  max_chars?: number;
  compression_threshold?: number;
}

/** Memory configuration. */
export interface MemoryConfig {
  enabled?: boolean;
  max_entries?: number;
}

/** Delegation configuration. */
export interface DelegationConfig {
  max_depth?: number;
  default_agent?: string;
}

/** Prefill messages file configuration. */
export interface PrefillMessagesConfig {
  file?: string;
}

/** Skills configuration. */
export interface SkillsConfig {
  enabled?: string[];
  disabled?: string[];
}

/** Honcho configuration. */
export interface HonchoConfig {
  enabled?: boolean;
  port?: number;
}

/** Timezone configuration. */
export interface TimezoneConfig {
  zone?: string;
}

/** Cron configuration. */
export interface CronConfig {
  enabled?: boolean;
  max_jobs?: number;
}

/** Code execution configuration. */
export interface CodeExecutionConfig {
  enabled?: boolean;
  sandbox?: string;
  timeout?: number;
}

/** Logging configuration. */
export interface LoggingConfig {
  level?: string;
  file?: string;
}

/** Network configuration. */
export interface NetworkConfig {
  proxy?: string;
  no_proxy?: string;
}

/** File read configuration. */
export interface FileReadConfig {
  max_chars?: number;
}

/** Discord platform configuration. */
export interface DiscordConfig {
  enabled?: boolean;
  token?: string;
  allowed_users?: string[];
}

/** WhatsApp configuration. */
export interface WhatsAppConfig {
  enabled?: boolean;
  account_sid?: string;
  auth_token?: string;
  from_number?: string;
}

/** Telegram configuration. */
export interface TelegramConfig {
  enabled?: boolean;
  bot_token?: string;
  allowed_users?: string[];
}

/** Slack configuration. */
export interface SlackConfig {
  enabled?: boolean;
  bot_token?: string;
  allowed_users?: string[];
  signing_secret?: string;
}

/** Mattermost configuration. */
export interface MattermostConfig {
  enabled?: boolean;
  url?: string;
  token?: string;
}

/** Approvals configuration. */
export interface ApprovalsConfig {
  enabled?: boolean;
  allowlist?: string[];
}

/** Command allowlist configuration. */
export interface CommandAllowlistConfig {
  enabled?: boolean;
  commands?: string[];
}

/** Quick commands configuration. */
export interface QuickCommandsConfig {
  enabled?: boolean;
  commands?: string[];
}

/** Personalities configuration. */
export interface PersonalitiesConfig {
  default?: string;
  available?: string[];
}

/** Security configuration. */
export interface SecurityConfig {
  approval_required?: boolean;
  dangerous_commands?: string[];
}

/** The full Hermes configuration matching DEFAULT_CONFIG. */
export interface HermesConfig {
  model?: ModelConfig | string;
  providers?: Record<string, ProviderConfig>;
  fallback_providers?: string[];
  credential_pool_strategies?: Record<string, string>;
  toolsets?: ToolsetsConfig;
  agent?: AgentConfig;
  terminal?: TerminalConfig;
  browser?: BrowserConfig;
  checkpoints?: CheckpointsConfig;
  compression?: CompressionConfig;
  bedrock?: BedrockConfig;
  auxiliary?: AuxiliaryConfig;
  display?: DisplayConfig;
  dashboard?: DashboardConfig;
  privacy?: PrivacyConfig;
  tts?: TtsConfig;
  stt?: SttConfig;
  voice?: VoiceConfig;
  human_delay?: HumanDelayConfig;
  context?: ContextConfig;
  memory?: MemoryConfig;
  delegation?: DelegationConfig;
  prefill_messages_file?: PrefillMessagesConfig;
  skills?: SkillsConfig;
  honcho?: HonchoConfig;
  timezone?: TimezoneConfig;
  cron?: CronConfig;
  code_execution?: CodeExecutionConfig;
  logging?: LoggingConfig;
  network?: NetworkConfig;
  file_read_max_chars?: number;
  discord?: DiscordConfig;
  whatsapp?: WhatsAppConfig;
  telegram?: TelegramConfig;
  slack?: SlackConfig;
  mattermost?: MattermostConfig;
  approvals?: ApprovalsConfig;
  command_allowlist?: CommandAllowlistConfig;
  quick_commands?: QuickCommandsConfig;
  personalities?: PersonalitiesConfig;
  security?: SecurityConfig;
  _config_version?: number;
}
