import { beforeEach, describe, expect, it, vi } from 'vitest';
import { projectStore } from '../projects';

const listMock = vi.hoisted(() => vi.fn());
const upsertMock = vi.hoisted(() => vi.fn());
const setActiveMock = vi.hoisted(() => vi.fn());
const worktreesMock = vi.hoisted(() => vi.fn());
const branchesMock = vi.hoisted(() => vi.fn());
const addWorktreeMock = vi.hoisted(() => vi.fn());
const removeWorktreeMock = vi.hoisted(() => vi.fn());
const switchBranchMock = vi.hoisted(() => vi.fn());

vi.mock('../context', () => ({
  getGateway: () => ({
    projects: {
      list: listMock,
      upsert: upsertMock,
      setActive: setActiveMock,
      worktrees: worktreesMock,
      branches: branchesMock,
      addWorktree: addWorktreeMock,
      removeWorktree: removeWorktreeMock,
      switchBranch: switchBranchMock,
    },
  }),
}));

beforeEach(() => {
  projectStore.resetForTests();
  listMock.mockReset().mockResolvedValue({
    projects: [{ path: '/repo', name: 'repo' }],
    active_path: '/repo',
  });
  upsertMock.mockReset().mockResolvedValue({ path: '/repo', name: 'repo' });
  setActiveMock.mockReset().mockResolvedValue({
    projects: [{ path: '/repo', name: 'repo' }],
    active_path: '/repo',
  });
  worktreesMock.mockReset().mockResolvedValue({
    worktrees: [{ path: '/repo', branch: 'main', bare: false, detached: false }],
  });
  branchesMock.mockReset().mockResolvedValue({ current: 'main', branches: ['main', 'dev'] });
  addWorktreeMock.mockReset().mockResolvedValue({ ok: true });
  removeWorktreeMock.mockReset().mockResolvedValue({ ok: true });
  switchBranchMock.mockReset().mockResolvedValue({ ok: true });
});

describe('projectStore', () => {
  it('load() populates projects and active path', async () => {
    await projectStore.load();
    expect(listMock).toHaveBeenCalled();
    expect(projectStore.projects().length).toBe(1);
    expect(projectStore.activePath()).toBe('/repo');
    expect(projectStore.loading()).toBe(false);
    expect(projectStore.error()).toBeNull();
  });

  it('loadWorktrees() fetches worktrees and branches together', async () => {
    await projectStore.loadWorktrees('/repo');
    expect(worktreesMock).toHaveBeenCalledWith('/repo');
    expect(branchesMock).toHaveBeenCalledWith('/repo');
    expect(projectStore.worktrees()?.worktrees.length).toBe(1);
    expect(projectStore.branches()?.current).toBe('main');
  });

  it('addWorktree() calls gateway then refreshes worktrees', async () => {
    await projectStore.addWorktree({ repoPath: '/repo', path: '/repo/wt', branch: 'dev', createBranch: true });
    expect(addWorktreeMock).toHaveBeenCalledWith({
      repoPath: '/repo',
      path: '/repo/wt',
      branch: 'dev',
      createBranch: true,
    });
    expect(worktreesMock).toHaveBeenCalledWith('/repo');
  });

  it('removeWorktree() calls gateway then refreshes worktrees', async () => {
    await projectStore.removeWorktree({ repoPath: '/repo', path: '/repo/wt' });
    expect(removeWorktreeMock).toHaveBeenCalledWith({ repoPath: '/repo', path: '/repo/wt' });
    expect(worktreesMock).toHaveBeenCalledWith('/repo');
  });

  it('switchBranch() calls gateway with path+branch then refreshes worktrees', async () => {
    await projectStore.switchBranch({ repoPath: '/repo', path: '/repo', branch: 'dev' });
    expect(switchBranchMock).toHaveBeenCalledWith({ path: '/repo', branch: 'dev' });
    expect(worktreesMock).toHaveBeenCalledWith('/repo');
  });

  it('sets error on failure', async () => {
    switchBranchMock.mockRejectedValueOnce(new Error('boom'));
    await projectStore.switchBranch({ repoPath: '/repo', path: '/repo', branch: 'dev' });
    expect(projectStore.error()).toBe('boom');
  });
});
