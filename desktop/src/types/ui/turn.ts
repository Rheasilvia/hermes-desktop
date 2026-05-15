/**
 * Ephemeral live-turn state — not persisted, exists only during active streaming.
 */

export type TurnStatus = 'idle' | 'streaming' | 'tool_running' | 'error' | 'interrupted';

export interface LiveTurnState {
  sessionId: string;
  status: TurnStatus;
  streamingText: string;
  reasoningText: string;
  activeTools: LiveToolCall[];
  errorMessage: string | null;
}

export interface LiveToolCall {
  id: string;
  name: string;
  status: 'generating' | 'running' | 'complete' | 'error';
  inputPreview: string | null;
  progressPreview: string | null;
  durationMs: number | null;
}
