/**
 * Session store - manages session list, active session, and CRUD operations.
 */

import { createSignal, createMemo } from 'solid-js';
import type { SessionListItem, SessionMeta } from '@/types/index.js';
import { getGateway } from './context.js';
import { modelStore } from './models.js';

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

  getLastWorkspace(): string | undefined {
    const all = sessions();
    for (const s of all) {
      if (s.workspace_path) return s.workspace_path;
    }
    return undefined;
  },

  updateWorkspace(sessionId: string, workspacePath: string) {
    setSessions(prev => prev.map(s =>
      s.id === sessionId ? { ...s, workspace_path: workspacePath } : s
    ));
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
      const resolvedParams = {
        ...params,
        model: params.model ?? modelStore.activeModel ?? undefined,
        workspace_path: params.workspace_path ?? this.getLastWorkspace() ?? '~/HermesWorkspace',
      };
      const meta = await gateway.session.create(resolvedParams);
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
      const sid = activeSessionId();
      if (!sid) return false;
      await gateway.session.interrupt(sid);
      return true;
    } catch {
      return false;
    }
  },

  clearError() {
    setError(null);
  },
};
