import { fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { projectStore } from '@/stores/projects.js';
import { workspaceTreeStore } from '@/stores/workspace-tree.js';
import { previewStore } from '@/stores/preview.js';
import { WorkspaceTreeView } from '../WorkspaceTreeView.js';

const mocks = vi.hoisted(() => ({
  gateway: {
    session: {
      updateCwd: vi.fn(),
    },
    projects: {
      list: vi.fn(),
      setActive: vi.fn(),
      worktrees: vi.fn(),
      branches: vi.fn(),
    },
    workspace: {
      children: vi.fn(),
    },
  },
}));

vi.mock('@/stores/context.js', () => ({
  getGateway: () => mocks.gateway,
}));

describe('WorkspaceTreeView projects', () => {
  beforeEach(() => {
    projectStore.resetForTests();
    void workspaceTreeStore.setWorkspace(null, null);
    mocks.gateway.projects.list.mockReset().mockResolvedValue({
      projects: [{ path: '/repo', name: 'repo', last_opened_at: 1 }],
      active_path: '/repo',
    });
    mocks.gateway.projects.setActive.mockReset().mockResolvedValue({
      projects: [{ path: '/repo-wt', name: 'repo-wt', last_opened_at: 2 }],
      active_path: '/repo-wt',
    });
    mocks.gateway.projects.worktrees.mockReset().mockResolvedValue({
      worktrees: [
        { path: '/repo', branch: 'main', bare: false, detached: false },
        { path: '/repo-wt', branch: 'feature', bare: false, detached: false },
      ],
    });
    mocks.gateway.projects.branches.mockReset().mockResolvedValue({
      current: 'main',
      branches: ['main', 'feature'],
    });
    mocks.gateway.session.updateCwd.mockReset().mockImplementation(async (_sessionId: string, cwd: string) => ({ cwd }));
    mocks.gateway.workspace.children.mockReset().mockImplementation(async (_sessionId: string, path: string) => ({
      root: path,
      path,
      children: [{ path: `${path}/src`, name: 'src', kind: 'directory', ignored: false, loaded: false }],
      truncated: false,
      total_read: 1,
    }));
  });

  it('renders backend projects and enters a worktree row', async () => {
    render(() => <WorkspaceTreeView sessionId="session-one" workspacePath="/repo" />);

    await waitFor(() => screen.getByLabelText('Active project'));
    await waitFor(() => screen.getByText('repo-wt'));
    await fireEvent.click(screen.getByText('repo-wt'));

    await waitFor(() => expect(mocks.gateway.projects.setActive).toHaveBeenCalledWith('/repo-wt'));
    expect(mocks.gateway.session.updateCwd).toHaveBeenCalledWith('session-one', '/repo-wt');
    expect(mocks.gateway.workspace.children).toHaveBeenCalledWith('session-one', '/repo-wt');
  });

  it('right-click Preview on a .ipynb routes to the notebook preview (not source view)', async () => {
    // Regression: the context-menu "Preview File" must route .ipynb through the same
    // notebook-aware openFile() as left-click — not the generic source preview.
    const registerNotebook = vi.spyOn(previewStore, 'registerNotebook').mockReturnValue(null);
    mocks.gateway.workspace.children.mockReset().mockResolvedValue({
      root: '/repo',
      path: '/repo',
      children: [{ path: '/repo/demo.ipynb', name: 'demo.ipynb', kind: 'file', ignored: false, loaded: true }],
      truncated: false,
      total_read: 1,
    });

    render(() => <WorkspaceTreeView sessionId="session-one" workspacePath="/repo" />);
    // The file tree only auto-loads when a project/worktree is entered; drive it directly.
    await workspaceTreeStore.setWorkspace('session-one', '/repo');

    const row = await waitFor(() => screen.getByText('demo.ipynb'));
    fireEvent.contextMenu(row, { clientX: 10, clientY: 10 });
    fireEvent.click(await waitFor(() => screen.getByText('Preview File')));

    expect(registerNotebook).toHaveBeenCalledWith(
      'session-one',
      expect.objectContaining({ path: '/repo/demo.ipynb' }),
    );
    registerNotebook.mockRestore();
  });
});
