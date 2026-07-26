import type { ToolCallRow } from '@/types/index.js';
import type { ToolCallBlock } from '@/types/index.js';
import type { LiveToolCall } from '@/types/index.js';

/**
 * Map a persisted ToolCallBlock to the presentation row shape.
 */
export function blockToRow(block: ToolCallBlock): ToolCallRow {
  return {
    id: block.id,
    name: block.name,
    status: block.status === 'streaming' ? 'generating' : block.status,
    argumentPreview: block.inputPreview,
    resultSummary: block.outputSummary,
    durationMs: block.durationMs,
  };
}

/**
 * Map a live-streaming LiveToolCall to the presentation row shape.
 */
export function liveToRow(live: LiveToolCall): ToolCallRow {
  return {
    id: live.id,
    name: live.name,
    status: live.status,
    argumentPreview: live.inputPreview,
    resultSummary: live.progressPreview,
    durationMs: live.durationMs,
  };
}

/**
 * Group similar tool names and return a human-readable summary.
 * Example: "read 4 files · 1 search · +2 more"
 */
export function buildSummary(rows: ToolCallRow[]): string {
  if (rows.length === 0) return '';

  const groups: Record<string, number> = {};
  for (const row of rows) {
    const key = normalizeToolName(row.name);
    groups[key] = (groups[key] ?? 0) + 1;
  }

  const sorted = Object.entries(groups).sort((a, b) => b[1] - a[1]);
  const maxGroups = 3;

  const parts = sorted.slice(0, maxGroups).map(([name, count]) => {
    return count === 1 ? `1 ${name}` : `${count} ${name}`;
  });

  if (sorted.length > maxGroups) {
    const remaining = sorted.slice(maxGroups).reduce((sum, e) => sum + e[1], 0);
    parts.push(`+${remaining} more`);
  }

  return parts.join(' · ');
}

/**
 * Normalize raw tool names into friendly labels.
 * e.g. "file_read" -> "file reads", "web_search" -> "searches"
 */
const DISPLAY_NAMES: Record<string, string> = {
  file_read: 'file read',
  file_write: 'file write',
  file_search: 'search',
  web_search: 'search',
  terminal: 'terminal',
  execute_code: 'code execution',
  browser_navigate: 'browser',
  delegate: 'delegation',
};

function normalizeToolName(name: string): string {
  return DISPLAY_NAMES[name] ?? name.replace(/_/g, ' ');
}
