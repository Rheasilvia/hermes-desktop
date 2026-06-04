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
    workspace_path: '/tmp/workspace',
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
    workspace_path: '/tmp/workspace',
    ...overrides,
  };
}

function gatewayWithSessions(initial: SessionListItem[]) {
  let current = [...initial];
  const create = vi.fn(async (params: { model?: string; system_prompt?: string; workspace_path?: string }) => {
    const existing = current.find((s) => s.message_count === 0 && ['Untitled', 'New Session', 'Untitled new conversation', ''].includes(s.title));
    if (existing && !params.model && !params.system_prompt && !params.workspace_path) {
      return meta({ id: existing.id, title: existing.title, workspace_path: existing.workspace_path ?? null });
    }

    const created = row({ id: `created-${create.mock.calls.length}`, title: 'New Session', message_count: 0 });
    current = [created, ...current];
    return meta({ id: created.id, title: created.title, workspace_path: created.workspace_path ?? null });
  });
  const list = vi.fn(async () => current);

  return {
    gateway: {
      session: {
        list,
        create,
        delete: vi.fn(async () => undefined),
        rename: vi.fn(async () => undefined),
        updateWorkspace: vi.fn(async () => undefined),
        branch: vi.fn(),
        resume: vi.fn(),
        interrupt: vi.fn(),
        info: vi.fn(),
        messages: vi.fn(),
      },
    } as unknown as GatewayAdapter,
    create,
    list,
  };
}

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
    const { create, gateway } = gatewayWithSessions([row({ id: 'last-1', workspace_path: '/tmp/last' })]);
    initializeStores(gateway);
    await sessionStore.loadSessions();

    await sessionStore.createSession({ model: 'claude', system_prompt: 'be terse' });

    expect(create).toHaveBeenCalledWith({ model: 'claude', system_prompt: 'be terse' });
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
