import { fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  diffData: {
    files: [],
    summary: { files_changed: 2, insertions: 12, deletions: 3 },
    working_dir: '/repo',
  },
  fetchDiff: vi.fn(async () => undefined),
  open: vi.fn(),
  openTab: vi.fn(),
  requestToolMenuOpen: vi.fn(),
  branches: vi.fn(async () => ({ current: 'dev', branches: ['dev', 'feature/env-panel'] })),
  checkout: vi.fn(async () => undefined),
}));

vi.mock('@/stores/git-view.js', () => ({
  gitViewStore: {
    diffData: () => mocks.diffData,
    fetchDiff: mocks.fetchDiff,
  },
}));

vi.mock('@/stores/side-panel.js', () => ({
  sidePanelStore: {
    open: mocks.open,
    openTab: mocks.openTab,
    requestToolMenuOpen: mocks.requestToolMenuOpen,
  },
}));

vi.mock('@/stores/context.js', () => ({
  getGateway: () => ({
    git: {
      branches: mocks.branches,
      checkout: mocks.checkout,
    },
  }),
}));

import { EnvironmentPanel } from '../EnvironmentPanel.js';

describe('EnvironmentPanel', () => {
  beforeEach(() => {
    mocks.diffData = {
      files: [],
      summary: { files_changed: 2, insertions: 12, deletions: 3 },
      working_dir: '/repo',
    };
    mocks.fetchDiff.mockClear();
    mocks.open.mockClear();
    mocks.openTab.mockClear();
    mocks.requestToolMenuOpen.mockClear();
    mocks.branches.mockClear();
    mocks.branches.mockResolvedValue({ current: 'dev', branches: ['dev', 'feature/env-panel'] });
    mocks.checkout.mockClear();
  });

  it('renders environment summary rows and disabled deferred actions', async () => {
    render(() => <EnvironmentPanel sessionId="session-1" workspacePath="/repo" />);

    expect(screen.getByRole('heading', { name: 'Environment' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open git changes' }).textContent).toContain('+12');
    expect(screen.getByRole('button', { name: 'Open git changes' }).textContent).toContain('-3');
    expect(screen.getByRole('button', { name: 'Open local workspace' }).textContent).toContain('repo');
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Switch git branch' }).textContent).toContain('dev');
    });

    expect((screen.getByRole('button', { name: 'Commit or push unavailable' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'GitHub CLI unavailable' }) as HTMLButtonElement).disabled).toBe(true);
    expect(mocks.fetchDiff).toHaveBeenCalledTimes(1);
    expect(mocks.branches).toHaveBeenCalledWith('session-1');
  });

  it('opens existing dock tabs from clickable rows and header plus', () => {
    render(() => <EnvironmentPanel sessionId="session-1" workspacePath="/repo" />);

    fireEvent.click(screen.getByRole('button', { name: 'Add environment tool' }));
    expect(mocks.open).toHaveBeenCalledTimes(1);
    expect(mocks.requestToolMenuOpen).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Open git changes' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open local workspace' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open source workspace' }));

    expect(mocks.openTab).toHaveBeenNthCalledWith(1, 'review');
    expect(mocks.openTab).toHaveBeenNthCalledWith(2, 'files');
    expect(mocks.openTab).toHaveBeenNthCalledWith(3, 'files');
  });

  it('switches branches through the existing git checkout route', async () => {
    render(() => <EnvironmentPanel sessionId="session-1" workspacePath="/repo" />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Switch git branch' }).textContent).toContain('dev');
    });

    fireEvent.click(screen.getByRole('button', { name: 'Switch git branch' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /feature\/env-panel/ }));

    await waitFor(() => {
      expect(mocks.checkout).toHaveBeenCalledWith('session-1', 'feature/env-panel');
    });
    await waitFor(() => {
      expect(mocks.fetchDiff).toHaveBeenCalledTimes(2);
    });
  });
});
