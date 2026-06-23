import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const sessionState = {
    activeSessionId: 'default-session' as string | null,
    sessions: [] as Array<{ id: string }>,
  };
  const profileTransport = {
    list: vi.fn(),
    active: vi.fn(),
    setActive: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    getState: vi.fn(),
    setState: vi.fn(),
    sessions: vi.fn(),
  };
  return {
    sessionState,
    profileTransport,
    chatStore: {
      getLiveState: vi.fn(),
      clearMessages: vi.fn(),
      loadMessages: vi.fn(),
    },
    configStore: {
      loadConfig: vi.fn(),
    },
    sessionStore: {
      get activeSessionId() { return sessionState.activeSessionId; },
      get sessions() { return sessionState.sessions; },
      loadSessions: vi.fn(),
      setActiveSession: vi.fn(),
      interrupt: vi.fn(),
    },
    modelsStore: {
      invalidate: vi.fn(),
      load: vi.fn(),
      loadActive: vi.fn(),
    },
  };
});

vi.mock('@/services/api', () => ({
  api: {
    profiles: () => mocks.profileTransport,
  },
}));

vi.mock('../chat', () => ({ chatStore: mocks.chatStore }));
vi.mock('../config', () => ({ configStore: mocks.configStore }));
vi.mock('../session', () => ({ sessionStore: mocks.sessionStore }));
vi.mock('../models', () => ({ modelsStore: mocks.modelsStore }));

describe('profileStore', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.sessionState.activeSessionId = 'default-session';
    mocks.sessionState.sessions = [];
    mocks.chatStore.getLiveState.mockReturnValue({
      status: 'idle',
      pendingPermission: false,
      pendingClarify: false,
    });
    mocks.profileTransport.setState.mockResolvedValue({ ok: true });
    mocks.profileTransport.setActive.mockResolvedValue({
      ok: true,
      activeProfileId: 'research',
      profile: { id: 'research' },
    });
    mocks.profileTransport.list.mockResolvedValue({
      activeProfileId: 'research',
      activeProfile: { id: 'research', name: 'research' },
      profiles: [
        { id: 'default', name: 'default' },
        { id: 'research', name: 'research' },
      ],
    });
    mocks.profileTransport.getState.mockResolvedValue({ value: null });
    mocks.sessionStore.loadSessions.mockImplementation(async () => {
      mocks.sessionState.sessions = [{ id: 'research-session' }];
    });
    mocks.sessionStore.setActiveSession.mockImplementation((id: string | null) => {
      mocks.sessionState.activeSessionId = id;
    });
    mocks.configStore.loadConfig.mockResolvedValue(undefined);
    mocks.chatStore.loadMessages.mockResolvedValue(undefined);
    mocks.modelsStore.load.mockResolvedValue(undefined);
    mocks.modelsStore.loadActive.mockResolvedValue(undefined);
  });

  it('reloads model state before a profile switch completes', async () => {
    const { profileStore } = await import('../profile');

    const ok = await profileStore.switchProfile('research');

    expect(ok).toBe(true);
    expect(mocks.profileTransport.setState).toHaveBeenCalledWith(
      'default',
      'last_session_id',
      'default-session',
    );
    expect(mocks.profileTransport.setActive).toHaveBeenCalledWith('research');
    expect(mocks.chatStore.clearMessages).toHaveBeenCalledWith('default-session');
    expect(mocks.configStore.loadConfig).toHaveBeenCalledOnce();
    expect(mocks.modelsStore.invalidate).toHaveBeenCalledOnce();
    expect(mocks.modelsStore.load).toHaveBeenCalledOnce();
    expect(mocks.modelsStore.loadActive).toHaveBeenCalledOnce();
    expect(mocks.sessionStore.setActiveSession).toHaveBeenLastCalledWith('research-session');
    expect(mocks.chatStore.loadMessages).toHaveBeenCalledWith('research-session');
    expect(
      mocks.modelsStore.invalidate.mock.invocationCallOrder[0],
    ).toBeLessThan(mocks.modelsStore.load.mock.invocationCallOrder[0]);
    expect(
      mocks.modelsStore.load.mock.invocationCallOrder[0],
    ).toBeLessThan(mocks.modelsStore.loadActive.mock.invocationCallOrder[0]);
  });
});
