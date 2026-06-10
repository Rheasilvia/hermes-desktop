import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  gateway: {
    workspace: {
      children: vi.fn(),
    },
    git: {
      diff: vi.fn(),
    },
  },
}));

vi.mock('../context.js', () => ({
  getGateway: () => mocks.gateway,
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
}

describe('sidePanelStore', () => {
  it('preserves active tab and width across close and reopen', async () => {
    vi.resetModules();
    const { sidePanelStore } = await import('../side-panel.js');

    sidePanelStore.open('git');
    sidePanelStore.setPanelWidth(640);
    sidePanelStore.close();
    sidePanelStore.open();

    expect(sidePanelStore.isOpen()).toBe(true);
    expect(sidePanelStore.activeTab()).toBe('git');
    expect(sidePanelStore.panelWidth()).toBe(640);
  });
});

describe('gitViewStore', () => {
  it('clears old diff state on workspace changes and ignores stale responses', async () => {
    vi.resetModules();
    const first = deferred<unknown>();
    const second = deferred<unknown>();
    mocks.gateway.git.diff
      .mockReset()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const { gitViewStore } = await import('../git-view.js');

    gitViewStore.setWorkspace('session-one', '/workspace-one');
    const firstFetch = gitViewStore.fetchDiff();
    gitViewStore.setWorkspace('session-two', '/workspace-two');
    const secondFetch = gitViewStore.fetchDiff();

    second.resolve({ files: [], summary: { files_changed: 0, insertions: 0, deletions: 0 }, working_dir: '/workspace-two' });
    await secondFetch;
    first.resolve({ files: [], summary: { files_changed: 1, insertions: 1, deletions: 0 }, working_dir: '/workspace-one' });
    await firstFetch;

    expect(gitViewStore.diffData()?.working_dir).toBe('/workspace-two');
    expect(gitViewStore.diffData()?.summary.files_changed).toBe(0);
    expect(gitViewStore.diffError()).toBeNull();
    expect(mocks.gateway.git.diff).toHaveBeenCalledWith('session-one');
    expect(mocks.gateway.git.diff).toHaveBeenCalledWith('session-two');
  });
});

describe('workspaceTreeStore', () => {
  it('does not leak expanded paths between workspaces', async () => {
    vi.resetModules();
    mocks.gateway.workspace.children.mockReset();
    mocks.gateway.workspace.children.mockImplementation(async (_sessionId: string, path: string) => {
        return {
          root: path,
          path,
          children: path === '/one'
            ? [{ path: '/one/src', name: 'src', kind: 'directory', ignored: false, loaded: false }]
            : [{ path: '/two/app', name: 'app', kind: 'directory', ignored: false, loaded: false }],
          truncated: false,
          total_read: 1,
        };
    });
    const { workspaceTreeStore } = await import('../workspace-tree.js');

    await workspaceTreeStore.setWorkspace('session-one', '/one');
    await workspaceTreeStore.toggleExpanded('/one/src');
    await workspaceTreeStore.setWorkspace('session-two', '/two');

    expect(workspaceTreeStore.state()?.root).toBe('/two');
    expect(workspaceTreeStore.state()?.expanded.has('/one/src')).toBe(false);
    expect(workspaceTreeStore.rows().map((row) => row.node.path)).toEqual(['/two', '/two/app']);
    expect(mocks.gateway.workspace.children).toHaveBeenCalledWith('session-one', '/one');
    expect(mocks.gateway.workspace.children).toHaveBeenCalledWith('session-two', '/two');
  });

  it('ignores stale tree responses after the workspace changes', async () => {
    vi.resetModules();
    const firstList = deferred<unknown>();
    const secondList = deferred<unknown>();
    mocks.gateway.workspace.children.mockReset();
    mocks.gateway.workspace.children.mockImplementation((_sessionId: string, path: string) => {
      return path === '/one' ? firstList.promise : secondList.promise;
    });
    const { workspaceTreeStore } = await import('../workspace-tree.js');

    const firstSet = workspaceTreeStore.setWorkspace('session-one', '/one');
    await flushPromises();
    const secondSet = workspaceTreeStore.setWorkspace('session-two', '/two');
    await flushPromises();

    secondList.resolve({
      root: '/two',
      path: '/two',
      children: [{ path: '/two/current.ts', name: 'current.ts', kind: 'file', ignored: false, loaded: true }],
      truncated: false,
      total_read: 1,
    });
    await secondSet;
    firstList.resolve({
      root: '/one',
      path: '/one',
      children: [{ path: '/one/stale.ts', name: 'stale.ts', kind: 'file', ignored: false, loaded: true }],
      truncated: false,
      total_read: 1,
    });
    await firstSet;

    expect(workspaceTreeStore.state()?.root).toBe('/two');
    expect(workspaceTreeStore.rows().map((row) => row.node.path)).toEqual(['/two', '/two/current.ts']);
  });
});
