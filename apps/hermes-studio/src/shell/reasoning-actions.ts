import { sessionStore } from '@/stores/session.js';
import type { ReasoningEffort } from '@/types/index.js';
import { nextReasoningEffort } from '@/features/conversation/reasoning-effort.js';

export function updateActiveReasoningEffort(effort: ReasoningEffort): void {
  const sessionId = sessionStore.activeSessionId;
  if (!sessionId) return;
  void sessionStore.updateRuntime(sessionId, { reasoningEffort: effort });
}

export function cycleActiveReasoningEffort(): void {
  const sessionId = sessionStore.activeSessionId;
  if (!sessionId) return;
  const current = sessionStore.getSessionReasoningEffort(sessionId);
  updateActiveReasoningEffort(nextReasoningEffort(current));
}
