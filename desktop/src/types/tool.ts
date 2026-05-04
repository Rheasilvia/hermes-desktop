/**
 * Tool types matching ToolEntry from registry.py.
 * @source tools/registry.py
 */

/** Schema for a tool parameter. */
export interface ToolParameter {
  name: string;
  description?: string;
  type: string;
  required?: boolean;
  default?: unknown;
  enum?: string[];
}

/** Schema definition for a tool. */
export interface ToolSchema {
  name: string;
  description: string;
  parameters?: {
    type: 'object';
    properties?: Record<string, ToolParameter>;
    required?: string[];
  };
}

/** Environment variables required by a tool. */
export type ToolEnvVar = string;

/** A registered tool in the registry. */
export interface ToolEntry {
  name: string;
  toolset: string;
  schema: ToolSchema;
  description?: string;
  emoji?: string;
  max_result_size_chars?: number;
  is_async?: boolean;
  requires_env?: ToolEnvVar[];
}

/** Info about a toolset. */
export interface ToolsetInfo {
  name: string;
  tools: string[];
  enabled: boolean;
  description?: string;
}

/** Active tool in current execution. */
export interface ActiveTool {
  context?: string;
  id: string;
  name: string;
  startedAt?: number;
}

/** Tool start event payload. */
export interface ToolStartEvent {
  tool_id: string;
  name: string;
  context?: string;
}

/** Tool progress/event payload. */
export interface ToolProgressEvent {
  tool_id?: string;
  name: string;
  preview?: string;
  progress?: string;
}

/** Tool complete event payload. */
export interface ToolCompleteEvent {
  tool_id: string;
  name: string;
  success?: boolean;
  error?: string;
}

/** Tool generating output event. */
export interface ToolGeneratingEvent {
  tool_id: string;
  name: string;
  text: string;
}
