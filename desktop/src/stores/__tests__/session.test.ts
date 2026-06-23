import { beforeEach, describe, expect, it, vi } from 'vitest';

import { initializeStores } from '../context';
import { sessionStore } from '../session';
import type { GatewayAdapter } from '../../services/gateway/types';
import type { SessionListItem, SessionMeta } from '../../types/index.js';

function row(overrides: Partial<SessionListItem> = {}): SessionListItem {
  return {
    id: 'session-1',
    title: 'Untitled',
    model: 'gpt-4',
    provider: null,
    started_at: '2026-05-25T00:00:00Z',
    message_count: 0,
    tool_call_count: 0,
    cwd: '/tmp/workspace',
    archived: false,
    archivedAt: null,
    permissionMode: 'auto',
    runtime: { reasoningEffort: 'medium', collaborationMode: 'default' },
    ...overrides,
  };
}

function meta(overrides: Partial<SessionMeta> = {}): SessionMeta {
  return {
    id: 'created-1',
    source: 'desktop',
    model: 'gpt-4',
    title: 'New Session',
    started_at: '2026-05-25T00:00:00Z',
    ended_at: null,
    message_count: 0,
    tool_call_count: 0,
    input_tokens: 0,
    output_tokens: 0,
    cache_read_tokens: 0,
    cache_write_tokens: 0,
    reasoning_tokens: 0,
    billing_provider: null,
    billing_base_url: null,
    billing_mode: 'auto',
    estimated_cost_usd: 0,
    actual_cost_usd: null,
    cost_status: null,
    cost_source: null,
    pricing_version: null,
    user_id: null,
    model_config: null,
    system_prompt: null,
    parent_session_id: null,
    end_reason: null,
    cwd: '/tmp/workspace',
    archived: false,
    archivedAt: null,
    permissionMode: 'auto',
    runtime: { reasoningEffort: 'medium', collaborationMode: 'default' },
    ...overrides,
  };
}

function gatewayWithSessions(initial: SessionListItem[]) {
  let current = [...initial];
  const create = vi.fn(async (params: { model?: string; system_prompt?: string; cwd?: string }) => {
    const existing = current.find((s) => s.message_count === 0 && ['Untitled', 'New Session', 'Untitled new conversation', ''].includes(s.title));
    if (existing && !params.model && !params.system_prompt && !params.cwd) {
      return meta({ id: existing.id, title: existing.title, cwd: existing.cwd ?? null });
    }

    const created = row({ id: `created-${create.mock.calls.length}`, title: 'New Session', message_count: 0 });
    current = [created, ...current];
    return meta({ id: created.id, title: created.title, cwd: created.cwd ?? null });
  });
  const list = vi.fn(async () => current);

  return {
    gateway: {
      session: {
        list,
        create,
        delete: vi.fn(async () => undefined),
        rename: vi.fn(async () => undefined),
        setArchived: vi.fn(async (_sessionId: string, archived: boolean) => ({
          archived,
          archivedAt: archived ? 1_800_000_000 : null,
        })),
        updateCwd: vi.fn(async (_sessionId: string, cwd: string) => ({ cwd })),
        setPermissionMode: vi.fn(async (sessionId: string, mode: SessionMeta['permissionMode']) =>
          meta({ id: sessionId, permissionMode: mode })
        ),
        updateRuntime: vi.fn(async (sessionId, patch) => ({
          id: sessionId,
          runtime: {
            reasoningEffort: patch.reasoningEffort ?? 'medium',
            collaborationMode: patch.collaborationMode ?? 'default',
          },
          appliedToActiveTurn: true,
          appliesNextTurn: false,
        })),
        branch: vi.fn(),
        resume: vi.fn(),
        interrupt: vi.fn(),
        info: vi.fn(),
        messages: vi.fn(),
      },
      image: {
        attach: vi.fn(async () => ({ attached: true, path: '', count: 1 })),
        detach: vi.fn(async () => ({ detached: true, count: 0 })),
      },
    } as unknown as GatewayAdapter,
    create,
    list,
  };
}

describe('sessionStore permission mode', () => {
  beforeEach(() => {
    initializeStores(null as unknown as GatewayAdapter);
    sessionStore.setActiveSession(null);
  });

  it('updates the cached session permission mode from the backend summary', async () => {
    const { gateway } = gatewayWithSessions([row({ id: 'session-1', permissionMode: 'auto' })]);
    initializeStores(gateway);
    await sessionStore.loadSessions();

    const updated = await sessionStore.setPermissionMode('session-1', 'full');

    expect(updated?.permissionMode).toBe('full');
    expect(sessionStore.sessions[0]?.permissionMode).toBe('full');
  });
});

describe('sessionStore runtime', () => {
  beforeEach(() => {
    initializeStores(null as unknown as GatewayAdapter);
    sessionStore.setActiveSession(null);
  });

  it('hydrates reasoning effort per session from the backend list', async () => {
    const { gateway } = gatewayWithSessions([
      row({ id: 'session-low', runtime: { reasoningEffort: 'low', collaborationMode: 'default' } }),
      row({ id: 'session-high', runtime: { reasoningEffort: 'high', collaborationMode: 'default' } }),
    ]);
    initializeStores(gateway);

    await sessionStore.loadSessions();

    expect(sessionStore.getSessionReasoningEffort('session-low')).toBe('low');
    expect(sessionStore.getSessionReasoningEffort('session-high')).toBe('high');
  });

  it('optimistically updates runtime and rolls back on backend failure', async () => {
    const { gateway } = gatewayWithSessions([
      row({ id: 'session-1', runtime: { reasoningEffort: 'medium', collaborationMode: 'default' } }),
    ]);
    vi.mocked(gateway.session.updateRuntime).mockRejectedValueOnce(new Error('SESSION_RUNTIME_FAILED'));
    initializeStores(gateway);
    await sessionStore.loadSessions();

    const promise = sessionStore.updateRuntime('session-1', { reasoningEffort: 'xhigh' });

    expect(sessionStore.getSessionReasoningEffort('session-1')).toBe('xhigh');
    const result = await promise;
    expect(result).toBeNull();
    expect(sessionStore.getSessionReasoningEffort('session-1')).toBe('medium');
    expect(sessionStore.error).toBe('SESSION_RUNTIME_FAILED');
  });

  it('hydrates and updates collaboration mode per session', async () => {
    const { gateway } = gatewayWithSessions([
      row({ id: 'session-1', runtime: { reasoningEffort: 'medium', collaborationMode: 'plan' } }),
    ]);
    initializeStores(gateway);
    await sessionStore.loadSessions();

    expect(sessionStore.getSessionCollaborationMode('session-1')).toBe('plan');

    await sessionStore.updateRuntime('session-1', { collaborationMode: 'default' });

    expect(gateway.session.updateRuntime).toHaveBeenCalledWith('session-1', {
      collaborationMode: 'default',
    });
    expect(sessionStore.getSessionCollaborationMode('session-1')).toBe('default');
  });
});

describe('sessionStore archive overlay', () => {
  beforeEach(() => {
    initializeStores(null as unknown as GatewayAdapter);
    sessionStore.setActiveSession(null);
  });

  it('archives a session by removing it from the active list', async () => {
    const { gateway } = gatewayWithSessions([
      row({ id: 'session-1', title: 'Active chat' }),
      row({ id: 'session-2', title: 'Other chat' }),
    ]);
    initializeStores(gateway);
    await sessionStore.loadSessions();
    sessionStore.setActiveSession('session-1');

    const result = await sessionStore.archiveSession('session-1');

    expect(result).toBe(true);
    expect(gateway.session.setArchived).toHaveBeenCalledWith('session-1', true);
    expect(sessionStore.activeSessionId).toBeNull();
    expect(sessionStore.sessions.map((s) => s.id)).toEqual(['session-2']);
    expect(sessionStore.archivedSessions.map((s) => s.id)).toEqual(['session-1']);
  });

  it('loads archived-only sessions and restores through the gateway', async () => {
    const { gateway } = gatewayWithSessions([
      row({ id: 'archived-1', title: 'Archived chat', archived: true }),
    ]);
    vi.mocked(gateway.session.list).mockImplementation(async (options) => (
      options?.archived === 'only'
        ? [row({ id: 'archived-1', title: 'Archived chat', archived: true })]
        : []
    ));
    initializeStores(gateway);

    await sessionStore.loadArchivedSessions();
    const result = await sessionStore.restoreSession('archived-1');

    expect(sessionStore.archivedSessions.map((s) => s.id)).toEqual([]);
    expect(result).toBe(true);
    expect(gateway.session.setArchived).toHaveBeenCalledWith('archived-1', false);
  });
});

describe('sessionStore new conversation creation', () => {
  beforeEach(async () => {
    vi.resetModules();
  });

  it('delegates empty-session reuse to the backend database state', async () => {
    const { gateway, create } = gatewayWithSessions([row({ id: 'empty-1', title: 'Untitled' })]);
    initializeStores(gateway);
    await sessionStore.loadSessions();

    const result = await sessionStore.createSession({});

    expect(result?.id).toBe('empty-1');
    expect(sessionStore.activeSessionId).toBe('empty-1');
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith({});
  });

  it('creates through the gateway when the only existing session has messages', async () => {
    const { create, gateway } = gatewayWithSessions([row({ id: 'used-1', message_count: 2 })]);
    initializeStores(gateway);
    await sessionStore.loadSessions();

    const result = await sessionStore.createSession({});

    expect(result?.id).toBe('created-1');
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith({});
  });

  it('reuses the backend fallback session on a second new conversation click', async () => {
    const { create, gateway, list } = gatewayWithSessions([]);
    initializeStores(gateway);
    await sessionStore.loadSessions();

    const first = await sessionStore.createSession({});
    await list();
    const second = await sessionStore.createSession({});

    expect(first?.id).toBe('created-1');
    expect(second?.id).toBe('created-1');
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('passes explicit creation params through instead of applying frontend fallbacks', async () => {
    const { create, gateway } = gatewayWithSessions([row({ id: 'last-1', cwd: '/tmp/last' })]);
    initializeStores(gateway);
    await sessionStore.loadSessions();

    await sessionStore.createSession({ model: 'claude', system_prompt: 'be terse' });

    expect(create).toHaveBeenCalledWith({ model: 'claude', system_prompt: 'be terse' });
  });

  it('updates cwd only after the backend returns the canonical path', async () => {
    const { gateway } = gatewayWithSessions([row({ id: 'session-1', cwd: '/tmp/old' })]);
    vi.mocked(gateway.session.updateCwd).mockResolvedValueOnce({ cwd: '/tmp/new-canonical' });
    initializeStores(gateway);
    await sessionStore.loadSessions();

    const result = await sessionStore.updateCwd('session-1', '/tmp/new');

    expect(result).toBe(true);
    expect(gateway.session.updateCwd).toHaveBeenCalledWith('session-1', '/tmp/new');
    expect(sessionStore.sessions.find((s) => s.id === 'session-1')?.cwd).toBe('/tmp/new-canonical');
  });

  it('keeps the previous cwd when backend persistence fails', async () => {
    const { gateway } = gatewayWithSessions([row({ id: 'session-1', cwd: '/tmp/old' })]);
    vi.mocked(gateway.session.updateCwd).mockRejectedValueOnce(new Error('SESSION_BUSY'));
    initializeStores(gateway);
    await sessionStore.loadSessions();

    const result = await sessionStore.updateCwd('session-1', '/tmp/new');

    expect(result).toBe(false);
    expect(sessionStore.sessions.find((s) => s.id === 'session-1')?.cwd).toBe('/tmp/old');
    expect(sessionStore.error).toBe('SESSION_BUSY');
  });
});

describe('sessionStore resume race guard', () => {
  beforeEach(() => {
    initializeStores(gatewayWithSessions([]).gateway);
    sessionStore.setActiveSession(null);
  });

  it('does not let a slow earlier resume overwrite the latest requested session', async () => {
    let resolveSlow!: () => void;
    let resolveFast!: () => void;
    const base = gatewayWithSessions([]).gateway;
    const resume = vi.fn((id: string) => new Promise<void>((resolve) => {
      if (id === 'slow-session') resolveSlow = resolve;
      if (id === 'fast-session') resolveFast = resolve;
    }));
    const gateway = {
      ...base,
      session: {
        ...base.session,
        resume,
      },
    } as unknown as GatewayAdapter;
    initializeStores(gateway);

    const slow = sessionStore.resumeSession('slow-session');
    const fast = sessionStore.resumeSession('fast-session');

    resolveFast();
    await fast;
    expect(sessionStore.activeSessionId).toBe('fast-session');

    resolveSlow();
    await slow;
    expect(sessionStore.activeSessionId).toBe('fast-session');
  });
});
