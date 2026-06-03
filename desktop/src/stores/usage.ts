/**
 * Per-session context usage store.
 * Populated from MessageCompletePayload fields on each turn completion.
 */

import { createStore } from 'solid-js/store';

interface SessionUsage {
  contextUsed: number | null;
  contextMax: number | null;
  contextPercent: number | null;
  costUsd: number | null;
  totalTokens: number | null;
}

const emptyUsage = (): SessionUsage => ({
  contextUsed: null,
  contextMax: null,
  contextPercent: null,
  costUsd: null,
  totalTokens: null,
});

const [usageStates, setUsageStates] = createStore<Record<string, SessionUsage>>({});

export const sessionUsage = {
  get(sessionId: string): SessionUsage {
    return usageStates[sessionId] ?? emptyUsage();
  },

  update(sessionId: string, payload: {
    context_used?: number | null;
    context_max?: number | null;
    context_percent?: number | null;
    cost_usd?: number | null;
    total?: number | null;
  }): void {
    setUsageStates(sessionId, {
      contextUsed: payload.context_used ?? null,
      contextMax: payload.context_max ?? null,
      contextPercent: payload.context_percent ?? null,
      costUsd: payload.cost_usd ?? null,
      totalTokens: payload.total ?? null,
    });
  },

  reset(sessionId: string): void {
    setUsageStates(sessionId, emptyUsage());
  },
};
