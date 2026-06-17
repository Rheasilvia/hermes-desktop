import type { McpConnectionStatus, McpServer } from '@/types/mcp.js';

export type McpStatusTone =
  | 'connected'
  | 'connecting'
  | 'configured'
  | 'failed'
  | 'disabled'
  | 'invalid';

export function mcpStatusTone(
  server: McpServer,
  status: McpConnectionStatus | undefined,
): McpStatusTone {
  if (server.valid === false) return 'invalid';
  const raw = status?.status?.toLowerCase();
  if (raw === 'invalid' || raw === 'invalid_config') return 'invalid';
  if (status?.disabled || server.enabled === false || raw === 'disabled') return 'disabled';
  if (raw === 'connected' || status?.connected) return 'connected';
  if (raw === 'connecting') return 'connecting';
  if (raw === 'failed' || raw === 'error' || status?.error) return 'failed';
  return 'configured';
}

export function mcpStatusLabel(tone: McpStatusTone): string {
  switch (tone) {
    case 'connected':
      return 'Online';
    case 'connecting':
      return 'Connecting';
    case 'configured':
      return 'Configured/Not started';
    case 'failed':
      return 'Failed';
    case 'disabled':
      return 'Disabled';
    case 'invalid':
      return 'Invalid config';
  }
}

export function mcpStatusCompactLabel(tone: McpStatusTone): string {
  if (tone === 'configured') return 'Configured';
  if (tone === 'invalid') return 'Invalid';
  return mcpStatusLabel(tone);
}
