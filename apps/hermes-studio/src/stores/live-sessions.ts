import { createMemo } from 'solid-js';
import { createStore } from 'solid-js/store';

export interface LiveSessionRecord {
  id: string;
  title?: string;
  status: 'active' | 'idle' | 'running';
  updatedAt: number;
}

interface LiveSessionsState {
  sessions: Record<string, LiveSessionRecord>;
  activeSessionId: string | null;
}

const [state, setState] = createStore<LiveSessionsState>({
  sessions: {},
  activeSessionId: null,
});

export const liveSessionStore = {
  get sessions() { return state.sessions; },
  get activeSessionId() { return state.activeSessionId; },

  setActiveSession(sessionId: string | null): void {
    setState('activeSessionId', sessionId);
    if (sessionId && state.sessions[sessionId]) {
      setState('sessions', sessionId, 'status', 'active');
      setState('sessions', sessionId, 'updatedAt', Date.now());
    }
  },

  upsertSession(record: Omit<LiveSessionRecord, 'updatedAt'> & { updatedAt?: number }): void {
    setState('sessions', record.id, {
      id: record.id,
      title: record.title,
      status: record.status,
      updatedAt: record.updatedAt ?? Date.now(),
    });
  },

  removeSession(sessionId: string): void {
    setState('sessions', (sessions) => {
      const next = { ...sessions };
      delete next[sessionId];
      return next;
    });
    if (state.activeSessionId === sessionId) setState('activeSessionId', null);
  },

  clear(): void {
    setState({ sessions: {}, activeSessionId: null });
  },
};

export const liveSessionList = createMemo(() =>
  Object.values(state.sessions).sort((a, b) => b.updatedAt - a.updatedAt),
);
