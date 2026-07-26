/** UI presentation shape for a tool call row in the tree/summary view.
 * Derived from ToolCallBlock (persisted) or LiveToolCall (streaming). */
export interface ToolCallRow {
  id: string;
  name: string;
  status: 'generating' | 'running' | 'complete' | 'error';
  argumentPreview: string | null;
  resultSummary: string | null;
  durationMs: number | null;
}
