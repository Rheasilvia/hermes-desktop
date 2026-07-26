/**
 * Chat store — shared state core.
 *
 * Owns the single fine-grained `createStore` instance that backs every
 * `chat-*` module, the per-session side-tables, and the turn/event
 * bookkeeping (stall watchdog, interrupt barrier, sequence dedupe).
 *
 * Keeping the store instance here — and importing it from the other chat
 * modules — preserves SolidJS fine-grained reactivity: handlers still mutate
 * via path selectors on the same store proxy, so only the affected field/row
 * re-renders.
 */

import { createStore } from 'solid-js/store';
import type { RenderedMessage } from '@/types/ui/message.js';
import type { LiveTurnState } from '@/types/ui/turn.js';

const TURN_STALLED_TIMEOUT_MS = 80_000;

interface ChatState {
  messages: RenderedMessage[];
  liveState: LiveTurnState;
  isLoadingMessages: boolean;
}

export interface ConversationDiagnosticsSnapshot {
  sessionId: string;
  turnState: LiveTurnState['status'];
  lastEventAt: number | null;
  droppedLateEvents: number;
}

export function makeLiveTurnState(sessionId: string): LiveTurnState {
  return {
    sessionId,
    turnId: null,
    lastEventSeq: null,
    status: 'idle',
    streamingText: '',
    reasoningText: '',
    activityBlocks: [],
    activeTools: [],
    todosToolId: null,
    todos: [],
    errorMessage: null,
    errorAction: null,
    pendingPermission: null,
    pendingClarify: null,
    pendingUserInput: null,
    memoryContext: null,
  };
}

// Fine-grained store: each session's ChatState is tracked at field level.
// Tool event handlers use path selectors so only the changed row re-renders.
export const [chatStates, setChatStates] = createStore<Record<string, ChatState>>({});
const stalledTimers = new Map<string, ReturnType<typeof setTimeout>>();
export const lastEventAtBySession = new Map<string, number>();
export const droppedLateEventsBySession = new Map<string, number>();
export const interruptedBarrierBySession = new Set<string>();

export function ensureSession(sessionId: string): void {
  if (!chatStates[sessionId]) {
    setChatStates(sessionId, {
      messages: [],
      liveState: makeLiveTurnState(sessionId),
      isLoadingMessages: false,
    });
  }
}

let _ephemeralCounter = 0;
export function nextEphemeralId(): string {
  return `ephemeral-${++_ephemeralCounter}`;
}

export function nextBlockId(): string {
  return `b-${++_ephemeralCounter}`;
}

export function clearStalledTimer(sessionId: string): void {
  const timer = stalledTimers.get(sessionId);
  if (timer) clearTimeout(timer);
  stalledTimers.delete(sessionId);
}

function armStalledTimer(sessionId: string): void {
  clearStalledTimer(sessionId);
  stalledTimers.set(sessionId, setTimeout(() => {
    const state = chatStates[sessionId]?.liveState.status;
    // Watchdog spans the whole live turn. If no stream event arrives for
    // TURN_STALLED_TIMEOUT_MS the turn is wedged (e.g. a stalled provider
    // stream that never sends a stop). Flip to 'stalled' so the recovery
    // banner + Stop affordance appear instead of an infinite spinner.
    if (
      state === 'submitting' || state === 'accepted' ||
      state === 'streaming' || state === 'tool_running'
    ) {
      setChatStates(sessionId, 'liveState', 'status', 'stalled');
    }
  }, TURN_STALLED_TIMEOUT_MS));
}

export function noteLiveEvent(sessionId: string): void {
  lastEventAtBySession.set(sessionId, Date.now());
  // Re-arm (rolling watchdog) so a stream that goes silent mid-turn is caught.
  armStalledTimer(sessionId);
}

export function beginLiveTurn(sessionId: string, status: LiveTurnState['status']): void {
  ensureSession(sessionId);
  interruptedBarrierBySession.delete(sessionId);
  setChatStates(sessionId, 'liveState', makeLiveTurnState(sessionId));
  setChatStates(sessionId, 'liveState', 'status', status);
  lastEventAtBySession.set(sessionId, Date.now());
  if (status === 'submitting' || status === 'accepted') {
    armStalledTimer(sessionId);
  } else {
    clearStalledTimer(sessionId);
  }
}

export function dropIfInterrupted(sessionId: string): boolean {
  if (!interruptedBarrierBySession.has(sessionId)) return false;
  droppedLateEventsBySession.set(sessionId, (droppedLateEventsBySession.get(sessionId) ?? 0) + 1);
  return true;
}

type TurnPayload = { turn_id?: string; event_seq?: number };

export function hasAssistantForTurn(sessionId: string, turnId: string | null | undefined): boolean {
  if (!turnId) return false;
  return (chatStates[sessionId]?.messages ?? []).some(
    (message) => message.role === 'assistant' && message.turnId === turnId,
  );
}

export function noteTurnEvent(sessionId: string, payload: TurnPayload): boolean {
  ensureSession(sessionId);
  const turnId = payload.turn_id ?? null;
  const eventSeq = payload.event_seq ?? null;
  if (turnId && hasAssistantForTurn(sessionId, turnId)) return false;

  const live = chatStates[sessionId]?.liveState ?? makeLiveTurnState(sessionId);
  if (turnId && live.turnId && live.turnId !== turnId && live.status !== 'idle') {
    return false;
  }

  const current = chatStates[sessionId]?.liveState ?? makeLiveTurnState(sessionId);
  if (
    turnId &&
    eventSeq != null &&
    current.turnId === turnId &&
    current.lastEventSeq != null &&
    eventSeq <= current.lastEventSeq
  ) {
    return false;
  }

  if (turnId) setChatStates(sessionId, 'liveState', 'turnId', turnId);
  if (eventSeq != null) setChatStates(sessionId, 'liveState', 'lastEventSeq', eventSeq);
  return true;
}
