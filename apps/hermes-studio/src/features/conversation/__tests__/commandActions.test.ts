import { describe, test, expect, vi, beforeEach } from 'vitest';
import { runCommandAction, type CommandActionDeps } from '../commandActions.js';

function makeDeps(overrides?: Partial<CommandActionDeps>): {
  deps: CommandActionDeps;
  navigate: ReturnType<typeof vi.fn>;
  notify: ReturnType<typeof vi.fn>;
  store: any;
} {
  const navigate = vi.fn();
  const notify = vi.fn();
  const store = {
    sessions: [
      { id: 'desktop_abc', title: 'Alpha' },
      { id: 'desktop_def', title: 'Beta' },
    ],
    createSession: vi.fn().mockResolvedValue({ id: 'desktop_new' }),
    branchSession: vi.fn().mockResolvedValue({ id: 'desktop_branch' }),
    resumeSession: vi.fn().mockResolvedValue(true),
    renameSession: vi.fn().mockResolvedValue(true),
  };
  const deps: CommandActionDeps = {
    sessionId: 'desktop_current',
    navigate,
    sessionStore: store,
    notify,
    ...overrides,
  };
  return { deps, navigate, notify, store };
}

describe('runCommandAction', () => {
  beforeEach(() => vi.clearAllMocks());

  test('new creates a session and navigates to it', async () => {
    const { deps, navigate, store } = makeDeps();
    await runCommandAction({ kind: 'action', action: 'new' }, deps);
    expect(store.createSession).toHaveBeenCalledWith({});
    expect(store.renameSession).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith('/conversation/desktop_new');
  });

  test('new with a message renames the created session', async () => {
    const { deps, store } = makeDeps();
    await runCommandAction({ kind: 'action', action: 'new', message: 'My Title' }, deps);
    expect(store.renameSession).toHaveBeenCalledWith('desktop_new', 'My Title');
  });

  test('branch branches the current session and navigates to the child', async () => {
    const { deps, navigate, store } = makeDeps();
    await runCommandAction({ kind: 'action', action: 'branch' }, deps);
    expect(store.branchSession).toHaveBeenCalledWith('desktop_current');
    expect(navigate).toHaveBeenCalledWith('/conversation/desktop_branch');
  });

  test('title renames the current session', async () => {
    const { deps, store, notify } = makeDeps();
    await runCommandAction({ kind: 'action', action: 'title', message: 'Renamed' }, deps);
    expect(store.renameSession).toHaveBeenCalledWith('desktop_current', 'Renamed');
    expect(notify).toHaveBeenCalledWith('Session renamed to "Renamed".');
  });

  test('title without a name reports a usage error and does not rename', async () => {
    const { deps, store, notify } = makeDeps();
    await runCommandAction({ kind: 'action', action: 'title', message: '   ' }, deps);
    expect(store.renameSession).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith('Command error: usage: /title <name>');
  });

  test('resume with a matching title resumes and navigates to that session', async () => {
    const { deps, navigate, store } = makeDeps();
    await runCommandAction({ kind: 'action', action: 'resume', message: 'beta' }, deps);
    expect(store.resumeSession).toHaveBeenCalledWith('desktop_def');
    expect(navigate).toHaveBeenCalledWith('/conversation/desktop_def');
  });

  test('resume with no match notifies and does not navigate', async () => {
    const { deps, navigate, store, notify } = makeDeps();
    await runCommandAction({ kind: 'action', action: 'resume', message: 'nope' }, deps);
    expect(store.resumeSession).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalled();
  });
});
