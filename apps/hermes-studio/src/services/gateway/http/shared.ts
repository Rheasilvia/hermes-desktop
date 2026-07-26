import type { CollaborationMode, DesktopPermissionMode, HermesConfig, ReasoningEffort, SessionRuntime } from '../types.js';
import type { HermesConfigRecord } from '@/services/api/types.js';

export const API_PREFIX = '/desktop/api';

export function permissionModeOf(value: unknown): DesktopPermissionMode {
  return value === 'ask' || value === 'full' ? value : 'auto';
}

export function reasoningEffortOf(value: unknown): ReasoningEffort {
  return value === 'none'
    || value === 'minimal'
    || value === 'low'
    || value === 'high'
    || value === 'xhigh'
    ? value
    : 'medium';
}

export function collaborationModeOf(value: unknown): CollaborationMode {
  return value === 'plan' ? 'plan' : 'default';
}

export function sessionRuntimeOf(value: unknown): SessionRuntime {
  const runtime = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    reasoningEffort: reasoningEffortOf(runtime.reasoningEffort),
    collaborationMode: collaborationModeOf(runtime.collaborationMode),
  };
}

export function setDotPath(target: HermesConfigRecord, path: string, value: unknown): void {
  const parts = path.split('.').filter(Boolean);
  if (!parts.length) return;
  let current: HermesConfigRecord = target;
  for (const part of parts.slice(0, -1)) {
    const child = current[part];
    if (!child || typeof child !== 'object' || Array.isArray(child)) {
      current[part] = {};
    }
    current = current[part] as HermesConfigRecord;
  }
  current[parts[parts.length - 1]] = value;
}

export function cloneConfig(config: HermesConfig): HermesConfigRecord {
  return { ...(config as HermesConfigRecord) };
}
