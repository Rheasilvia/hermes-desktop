/**
 * Session store - manages session list, active session, and CRUD operations.
 */

import { createSignal, createMemo } from 'solid-js';
import type { DesktopPermissionMode, SessionListItem, SessionMeta } from '@/types/index.js';
import { getGateway } from './context.js';

const [sessions, setSessions] = createSignal<SessionListItem[]>([]);
const [activeSessionId, setActiveSessionId] = createSignal<string | null>(null);
const [isLoading, setIsLoading] = createSignal(false);
const [error, setError] = createSignal<string | null>(null);
const [sessionModels, setSessionModels] = createSignal<
  Record<string, { provider: string; model: string }>
>({});
let resumeRequestEpoch = 0;

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

  getLastCwd(): string | undefined {
    const all = sessions();
    for (const s of all) {
      if (s.cwd) return s.cwd;
    }
    return undefined;
  },

  async updateCwd(sessionId: string, cwd: string): Promise<boolean> {
    const gateway = getGateway();
    if (!gateway) return false;
    setError(null);
    try {
      const result = await gateway.session.updateCwd(sessionId, cwd);
      const resolvedCwd = result.cwd || cwd;
      setSessions(prev => prev.map(s =>
        s.id === sessionId ? { ...s, cwd: resolvedCwd } : s
      ));
      return true;
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to update working directory';
      setError(message);
      console.error('[sessionStore] failed to persist cwd:', e);
      return false;
    }
  },

  applyCwd(sessionId: string, cwd: string): void {
    setSessions(prev => prev.map(s =>
      s.id === sessionId ? { ...s, cwd } : s
    ));
  },

  async setPermissionMode(sessionId: string, mode: DesktopPermissionMode): Promise<SessionMeta | null> {
    const gateway = getGateway();
    if (!gateway) return null;
    setError(null);
    try {
      const updated = await gateway.session.setPermissionMode(sessionId, mode);
      setSessions(prev => prev.map(s =>
        s.id === sessionId ? {
          ...s,
          permissionMode: updated.permissionMode,
          cwd: updated.cwd ?? s.cwd,
          model: updated.model || s.model,
          provider: (updated as unknown as { provider?: string | null }).provider ?? s.provider,
          title: updated.title ?? s.title,
          message_count: updated.message_count ?? s.message_count,
        } : s
      ));
      return updated;
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to update permission mode';
      setError(message);
      console.error('[sessionStore] failed to persist permission mode:', e);
      return null;
    }
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

  async createSession(params: { model?: string; provider?: string; system_prompt?: string; cwd?: string }): Promise<SessionMeta | null> {
    const gateway = getGateway();
    if (!gateway) return null;
    setIsLoading(true);
    setError(null);
    try {
      // Pass params straight through. A blank `createSession({})` must reach
      // the backend as `create({})` so the empty-session reuse guard fires and
      // the backend resolves the default (Model Page primary) model itself.
      // Do NOT inject modelStore.activeModel here — it is session-scoped state
      // (ChatView syncs it on session switch), so injecting it would make new
      // conversations inherit the previously-viewed session's model and would
      // defeat the backend reuse guard.
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

  async renameSession(id: string, title: string): Promise<boolean> {
    const gateway = getGateway();
    if (!gateway) return false;
    setError(null);
    try {
      await gateway.session.rename(id, title);
      await this.loadSessions();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to rename session');
      return false;
    }
  },

  updateSessionTitle(sessionId: string, title: string): void {
    setSessions(prev => prev.map(s =>
      s.id === sessionId ? { ...s, title } : s
    ));
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
    const requestEpoch = ++resumeRequestEpoch;
    setIsLoading(true);
    setError(null);
    try {
      await gateway.session.resume(id);
      if (requestEpoch === resumeRequestEpoch) {
        setActiveSessionId(id);
      }
      return true;
    } catch (e) {
      if (requestEpoch === resumeRequestEpoch) {
        setError(e instanceof Error ? e.message : 'Failed to resume session');
      }
      return false;
    } finally {
      if (requestEpoch === resumeRequestEpoch) {
        setIsLoading(false);
      }
    }
  },

  async interrupt(): Promise<boolean> {
    const gateway = getGateway();
    if (!gateway) return false;
    try {
      const sid = activeSessionId();
      if (!sid) return false;
      await gateway.session.interrupt(sid);
      return true;
    } catch {
      return false;
    }
  },

  getSessionModel(sessionId: string) {
    return sessionModels()[sessionId] ?? null;
  },

  setSessionModel(sessionId: string, provider: string, model: string) {
    setSessionModels(prev => ({ ...prev, [sessionId]: { provider, model } }));
  },

  clearError() {
    setError(null);
  },
};
