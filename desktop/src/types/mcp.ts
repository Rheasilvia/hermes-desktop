/**
 * MCP server types matching tools/mcp_tool.py.
 * @source tools/mcp_tool.py
 */

/** MCP server transport type. */
export type McpTransport = 'stdio' | 'http' | 'streamable_http';

/** MCP server authentication type. */
export type McpAuthType = 'oauth' | 'bearer' | 'api_key' | null;

/** MCP server configuration. */
export interface McpServer {
  name: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  timeout?: number;
  connect_timeout?: number;
  auth?: McpAuthType;
  oauth?: McpOAuthConfig;
  sampling?: McpSamplingConfig;
  transport?: McpTransport;
}

/** MCP OAuth configuration. */
export interface McpOAuthConfig {
  client_id?: string;
  client_secret?: string;
  auth_url?: string;
  token_url?: string;
  scopes?: string[];
}

/** MCP sampling configuration for server-initiated LLM requests. */
export interface McpSamplingConfig {
  enabled?: boolean;
  model?: string;
  max_tokens_cap?: number;
  timeout?: number;
  max_rpm?: number;
  allowed_models?: string[];
  max_tool_rounds?: number;
  log_level?: 'debug' | 'info' | 'warning';
}

/** MCP tool as returned by list_tools. */
export interface McpTool {
  name: string;
  description?: string;
  inputSchema?: McpInputSchema;
}

/** MCP input schema for a tool. */
export interface McpInputSchema {
  type?: string;
  properties?: Record<string, McpSchemaProperty>;
  required?: string[];
}

/** MCP schema property. */
export interface McpSchemaProperty {
  type?: string;
  description?: string;
  default?: unknown;
  enum?: unknown[];
}

/** MCP server connection state. */
export interface McpConnectionStatus {
  name: string;
  connected: boolean;
  transport: McpTransport;
  tools: number;
  error?: string;
}
