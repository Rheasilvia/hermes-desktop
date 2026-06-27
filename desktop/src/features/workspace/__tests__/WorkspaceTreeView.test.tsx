import { fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { projectStore } from '@/stores/projects.js';
import { workspaceTreeStore } from '@/stores/workspace-tree.js';
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
});
