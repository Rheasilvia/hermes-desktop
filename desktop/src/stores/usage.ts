/**
 * Per-session context usage store.
 * Populated from MessageCompletePayload fields on each turn completion, and
 * persisted to localStorage so the token-usage bar survives app restarts
 * (the live values are restored on launch instead of resetting to zero).
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

const STORAGE_KEY_USAGE = 'hermes-desktop-session-usage';

/** Coerce one persisted entry into a SessionUsage, or null if malformed. */
function coerceUsage(value: unknown): SessionUsage | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  const num = (x: unknown): number | null =>
    typeof x === 'number' && Number.isFinite(x) ? x : null;
  return {
    contextUsed: num(v.contextUsed),
    contextMax: num(v.contextMax),
    contextPercent: num(v.contextPercent),
    costUsd: num(v.costUsd),
    totalTokens: num(v.totalTokens),
  };
}

function loadPersistedUsage(): Record<string, SessionUsage> {
  try {
    const stored = localStorage.getItem(STORAGE_KEY_USAGE);
    if (!stored) return {};
    const parsed: unknown = JSON.parse(stored);
    if (typeof parsed !== 'object' || parsed === null) return {};
    const out: Record<string, SessionUsage> = {};
    for (const [sid, entry] of Object.entries(parsed as Record<string, unknown>)) {
      const coerced = coerceUsage(entry);
      if (coerced) out[sid] = coerced;
    }
    return out;
  } catch {}
  return {};
}

const [usageStates, setUsageStates] = createStore<Record<string, SessionUsage>>(loadPersistedUsage());

/** Best-effort write of the whole map; persistence failures are non-fatal. */
function persist(): void {
  try {
    localStorage.setItem(STORAGE_KEY_USAGE, JSON.stringify(usageStates));
  } catch {}
}

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
    persist();
  },

  reset(sessionId: string): void {
    setUsageStates(sessionId, emptyUsage());
    persist();
  },
};
