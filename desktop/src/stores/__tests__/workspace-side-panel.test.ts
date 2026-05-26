import { describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
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
    const { invoke } = await import('@tauri-apps/api/core');
    const invokeMock = vi.mocked(invoke);
    const first = deferred<unknown>();
    const second = deferred<unknown>();
    invokeMock
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const { gitViewStore } = await import('../git-view.js');

    gitViewStore.setWorkspacePath('/workspace-one');
    const firstFetch = gitViewStore.fetchDiff();
    gitViewStore.setWorkspacePath('/workspace-two');
    const secondFetch = gitViewStore.fetchDiff();

    second.resolve({ files: [], summary: { files_changed: 0, insertions: 0, deletions: 0 }, working_dir: '/workspace-two' });
    await secondFetch;
    first.resolve({ files: [], summary: { files_changed: 1, insertions: 1, deletions: 0 }, working_dir: '/workspace-one' });
    await firstFetch;

    expect(gitViewStore.diffData()?.working_dir).toBe('/workspace-two');
    expect(gitViewStore.diffData()?.summary.files_changed).toBe(0);
    expect(gitViewStore.diffError()).toBeNull();
  });
});

describe('workspaceTreeStore', () => {
  it('does not leak expanded paths between workspaces', async () => {
    vi.resetModules();
    const { invoke } = await import('@tauri-apps/api/core');
    vi.mocked(invoke).mockImplementation(async (command, args) => {
      if (command === 'get_workspace_root') return (args as { path: string }).path;
      if (command === 'list_workspace_children') {
        const path = (args as { path: string }).path;
        return {
          root: (args as { root: string }).root,
          path,
          children: path === '/one'
            ? [{ path: '/one/src', name: 'src', kind: 'directory', ignored: false, loaded: false }]
            : [{ path: '/two/app', name: 'app', kind: 'directory', ignored: false, loaded: false }],
          truncated: false,
          total_read: 1,
        };
      }
      throw new Error(`unexpected command: ${command}`);
    });
    const { workspaceTreeStore } = await import('../workspace-tree.js');

    await workspaceTreeStore.setWorkspacePath('/one');
    await workspaceTreeStore.toggleExpanded('/one/src');
    await workspaceTreeStore.setWorkspacePath('/two');

    expect(workspaceTreeStore.state()?.root).toBe('/two');
    expect(workspaceTreeStore.state()?.expanded.has('/one/src')).toBe(false);
    expect(workspaceTreeStore.rows().map((row) => row.node.path)).toEqual(['/two', '/two/app']);
  });

  it('ignores stale tree responses after the workspace changes', async () => {
    vi.resetModules();
    const { invoke } = await import('@tauri-apps/api/core');
    const firstList = deferred<unknown>();
    const secondList = deferred<unknown>();
    vi.mocked(invoke).mockImplementation((command, args) => {
      if (command === 'get_workspace_root') return Promise.resolve((args as { path: string }).path);
      if (command === 'list_workspace_children') {
        const path = (args as { path: string }).path;
        return path === '/one' ? firstList.promise : secondList.promise;
      }
      return Promise.reject(new Error(`unexpected command: ${command}`));
    });
    const { workspaceTreeStore } = await import('../workspace-tree.js');

    const firstSet = workspaceTreeStore.setWorkspacePath('/one');
    await flushPromises();
    const secondSet = workspaceTreeStore.setWorkspacePath('/two');
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
