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

const tabKinds = (tabs: Array<{ kind: string }>) => tabs.map((tab) => tab.kind);

describe('sidePanelStore', () => {
  it('opens to the tools tab shell by default and supports direct tab activation', async () => {
    vi.resetModules();
    const { sidePanelStore } = await import('../side-panel.js');

    sidePanelStore.open('terminal', { cwd: '/repo/PreDoc' });
    sidePanelStore.setPanelWidth(640);

    expect(sidePanelStore.isOpen()).toBe(true);
    expect(sidePanelStore.activeView()).toBe('terminal');
    expect(tabKinds(sidePanelStore.openTabs())).toEqual(['terminal']);
    expect(sidePanelStore.activeTab()?.title).toBe('PreDoc');

    sidePanelStore.setActiveView('review');

    expect(sidePanelStore.activeView()).toBe('review');
    expect(tabKinds(sidePanelStore.openTabs())).toEqual(['terminal', 'review']);

    sidePanelStore.close();
    sidePanelStore.open();

    expect(sidePanelStore.isOpen()).toBe(true);
    expect(sidePanelStore.activeView()).toBe('review');
    expect(tabKinds(sidePanelStore.openTabs())).toEqual(['terminal', 'review']);
    expect(sidePanelStore.panelWidth()).toBe(640);
  });

  it('creates multiple terminal instances while keeping other tools singleton', async () => {
    vi.resetModules();
    const { sidePanelStore } = await import('../side-panel.js');

    const first = sidePanelStore.openTab('terminal', { cwd: '/repo/PreDoc' });
    const second = sidePanelStore.openTab('terminal', { cwd: '/repo/PreDoc' });
    sidePanelStore.openTab('files');
    sidePanelStore.openTab('files');

    expect(first.id).not.toBe(second.id);
    expect(tabKinds(sidePanelStore.openTabs())).toEqual(['terminal', 'terminal', 'files']);
    expect(sidePanelStore.openTabs().map((tab) => tab.title)).toEqual(['PreDoc', 'PreDoc 2', 'Open file']);
    expect(sidePanelStore.activeTabId()).toBe('tool-files');
  });

  it('renames tabs with non-empty titles only', async () => {
    vi.resetModules();
    const { sidePanelStore } = await import('../side-panel.js');

    const tab = sidePanelStore.openTab('terminal', { cwd: '/repo/PreDoc' });

    sidePanelStore.renameTab(tab.id, '  Shell A  ');
    expect(sidePanelStore.openTabs()[0]?.title).toBe('Shell A');

    sidePanelStore.renameTab(tab.id, '   ');
    expect(sidePanelStore.openTabs()[0]?.title).toBe('Shell A');
  });
});

describe('sidePanelStore.closeTab', () => {
  it('leaves the active view and remaining tabs intact when closing a non-active tab', async () => {
    vi.resetModules();
    const { sidePanelStore } = await import('../side-panel.js');

    sidePanelStore.openTab('terminal');
    sidePanelStore.openTab('files');
    sidePanelStore.setActiveView('terminal');

    sidePanelStore.closeTab('files');

    expect(tabKinds(sidePanelStore.openTabs())).toEqual(['terminal']);
    expect(sidePanelStore.activeView()).toBe('terminal');
    expect(sidePanelStore.isOpen()).toBe(true);
  });

  it('reassigns the active view to the right neighbor when the active tab is closed', async () => {
    vi.resetModules();
    const { sidePanelStore } = await import('../side-panel.js');

    sidePanelStore.openTab('terminal');
    sidePanelStore.openTab('files');
    sidePanelStore.openTab('review');
    sidePanelStore.setActiveView('files');

    sidePanelStore.closeTab('files');

    expect(tabKinds(sidePanelStore.openTabs())).toEqual(['terminal', 'review']);
    expect(sidePanelStore.activeView()).toBe('review');
    expect(sidePanelStore.isOpen()).toBe(true);
  });

  it('collapses the dock and resets to the menu state when the last tab is closed', async () => {
    vi.resetModules();
    const { sidePanelStore } = await import('../side-panel.js');

    sidePanelStore.openTab('terminal');
    const tabId = sidePanelStore.activeTabId();
    expect(sidePanelStore.isOpen()).toBe(true);

    sidePanelStore.closeTab(tabId!);

    expect(sidePanelStore.openTabs()).toEqual([]);
    expect(sidePanelStore.activeView()).toBe('menu');
    expect(sidePanelStore.isOpen()).toBe(false);
  });
});

describe('sidePanelStore tool menu request', () => {
  it('clears the pending add-tool menu request when the dock closes', async () => {
    vi.resetModules();
    const { sidePanelStore } = await import('../side-panel.js');

    sidePanelStore.open();
    sidePanelStore.requestToolMenuOpen();

    expect(sidePanelStore.toolMenuOpenRequested()).toBe(true);

    sidePanelStore.close();

    expect(sidePanelStore.toolMenuOpenRequested()).toBe(false);

    sidePanelStore.requestToolMenuOpen();
    sidePanelStore.clearTabs();

    expect(sidePanelStore.toolMenuOpenRequested()).toBe(false);
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
