/**
 * Session store - manages session list, active session, and CRUD operations.
 */

import { createSignal, createMemo } from 'solid-js';
import type { SessionListItem, SessionMeta } from '@/types/index.js';
import { getGateway } from './context.js';

const [sessions, setSessions] = createSignal<SessionListItem[]>([]);
const [activeSessionId, setActiveSessionId] = createSignal<string | null>(null);
const [isLoading, setIsLoading] = createSignal(false);
const [error, setError] = createSignal<string | null>(null);

const activeSession = createMemo(() => {
  const id = activeSessionId();
  if (!id) return null;
  return sessions().find(s => s.id === id) ?? null;
});

export const sessionStore = {
  get sessions() { return sessions(); },
  get activeSessionId() { return activeSessionId(); },
  get activeSession() { return activeSession(); },
  get isLoading() { return isLoading(); },
  get error() { return error(); },

  setActiveSession(id: string | null) {
    setActiveSessionId(id);
  },

  async loadSessions(): Promise<void> {
    const gateway = getGateway();
    if (!gateway) {
      setSessions([]);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const list = await gateway.session.list();
      setSessions(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load sessions');
    } finally {
      setIsLoading(false);
    }
  },

  async createSession(params: { model?: string; system_prompt?: string; workspace_path?: string }): Promise<SessionMeta | null> {
    const gateway = getGateway();
    if (!gateway) return null;
    setIsLoading(true);
    setError(null);
    try {
      const meta = await gateway.session.create(params);
      await this.loadSessions();
      setActiveSessionId(meta.id);
      return meta;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create session');
      return null;
    } finally {
      setIsLoading(false);
    }
  },

  async deleteSession(id: string): Promise<boolean> {
    const gateway = getGateway();
    if (!gateway) return false;
    setIsLoading(true);
    setError(null);
    try {
      await gateway.session.delete(id);
      if (activeSessionId() === id) {
        setActiveSessionId(null);
      }
      await this.loadSessions();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete session');
      return false;
    } finally {
      setIsLoading(false);
    }
  },

  async branchSession(id: string): Promise<SessionMeta | null> {
    const gateway = getGateway();
    if (!gateway) return null;
    setIsLoading(true);
    setError(null);
    try {
      const meta = await gateway.session.branch(id);
      await this.loadSessions();
      setActiveSessionId(meta.id);
      return meta;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to branch session');
      return null;
    } finally {
      setIsLoading(false);
    }
  },

  async resumeSession(id: string): Promise<boolean> {
    const gateway = getGateway();
    if (!gateway) return false;
    setIsLoading(true);
    setError(null);
    try {
      await gateway.session.resume(id);
      setActiveSessionId(id);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to resume session');
      return false;
    } finally {
      setIsLoading(false);
    }
  },

  async interrupt(): Promise<boolean> {
    const gateway = getGateway();
    if (!gateway) return false;
    try {
      await gateway.session.interrupt();
      return true;
    } catch {
      return false;
    }
  },

  clearError() {
    setError(null);
  },
};
