import { render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/stores/git-view.js', () => ({
  gitViewStore: {
    diffData: () => null,
    diffLoading: () => false,
    diffError: () => null,
    activeFileIndex: () => 0,
    selectDiffFile: vi.fn(),
    fetchDiff: vi.fn(),
  },
}));

vi.mock('@/features/workspace/WorkspaceTreeView.js', () => ({
  WorkspaceTreeView: () => <div data-testid="files-view" />,
}));

vi.mock('@/features/diff/DiffPanel.js', () => ({
  DiffPanel: () => <div data-testid="review-view" />,
}));

vi.mock('@/features/delegation/DelegationSidePanel.js', () => ({
  DelegationSidePanel: () => <div data-testid="delegation-view" />,
}));

vi.mock('../TerminalPanel.js', () => ({
  TerminalPanel: (props: { active: boolean; cwd: string | null }) => (
    <div
      data-testid="terminal-view"
      data-active={props.active ? 'true' : 'false'}
      data-cwd={props.cwd ?? ''}
    />
  ),
}));

import { sidePanelStore } from '@/stores/side-panel.js';
import { RightToolPanel } from '../RightToolPanel.js';

describe('RightToolPanel', () => {
  beforeEach(() => {
    sidePanelStore.clearTabs();
    sidePanelStore.open();
  });

  afterEach(() => {
    sidePanelStore.close();
    sidePanelStore.clearTabs();
  });

  it('renders only the tool content area and empty state by default', () => {
    render(() => (
      <RightToolPanel sessionId="session-1" workspacePath="/repo" />
    ));

    expect(screen.getByRole('status', { name: 'No tool tab selected' })).toBeTruthy();
    expect(screen.queryByRole('tablist', { name: 'Tool tabs' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add tool tab' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Browser' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Side chat' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Close tools/i })).toBeNull();
  });

  it('renders terminal content when the terminal tab is active', () => {
    sidePanelStore.openTab('terminal', { cwd: '/repo' });
    render(() => (
      <RightToolPanel sessionId="session-1" workspacePath="/repo" />
    ));

    expect(screen.getByTestId('terminal-view')).toBeTruthy();
    expect(screen.getByTestId('terminal-view').getAttribute('data-active')).toBe('true');
    expect(screen.getByTestId('terminal-view').getAttribute('data-cwd')).toBe('/repo');
    expect(sidePanelStore.openTabs().map((tab) => tab.kind)).toEqual(['terminal']);
  });

  it('renders one terminal panel per terminal tab with a single active instance', () => {
    const first = sidePanelStore.openTab('terminal', { cwd: '/repo/a' });
    const second = sidePanelStore.openTab('terminal', { cwd: '/repo/b' });

    render(() => (
      <RightToolPanel sessionId="session-1" workspacePath="/repo" />
    ));

    const terminals = screen.getAllByTestId('terminal-view');
    expect(terminals).toHaveLength(2);
    expect(terminals.map((terminal) => terminal.getAttribute('data-cwd'))).toEqual(['/repo/a', '/repo/b']);
    expect(terminals.map((terminal) => terminal.getAttribute('data-active'))).toEqual(['false', 'true']);

    sidePanelStore.setActiveTab(first.id);
    expect(terminals.map((terminal) => terminal.getAttribute('data-active'))).toEqual(['true', 'false']);

    sidePanelStore.setActiveTab(second.id);
    expect(terminals.map((terminal) => terminal.getAttribute('data-active'))).toEqual(['false', 'true']);
  });

  it('freezes tool body width only in deferred resize mode', () => {
    const [resizing, setResizing] = createSignal(true);
    const [contentWidth, setContentWidth] = createSignal(500);
    sidePanelStore.openTab('terminal', { cwd: '/repo' });

    render(() => (
      <RightToolPanel
        sessionId="session-1"
        workspacePath="/repo"
        contentWidth={contentWidth()}
        resizeMode="deferred"
        resizing={resizing()}
      />
    ));

    const body = screen.getByLabelText('Right tools dock').firstElementChild as HTMLElement;

    expect(body.style.width).toBe('500px');
    expect(body.className).toContain('bodyFrozen');

    setContentWidth(580);
    setResizing(false);

    expect(body.style.width).toBe('');
    expect(body.className).not.toContain('bodyFrozen');
  });

  it('keeps tool body live while resizing in live mode', () => {
    const [contentWidth, setContentWidth] = createSignal(500);
    sidePanelStore.setActiveView('review');

    render(() => (
      <RightToolPanel
        sessionId="session-1"
        workspacePath="/repo"
        contentWidth={contentWidth()}
        resizeMode="live"
        resizing={true}
      />
    ));

    const body = screen.getByLabelText('Right tools dock').firstElementChild as HTMLElement;

    expect(body.style.width).toBe('');
    expect(body.className).not.toContain('bodyFrozen');

    setContentWidth(580);

    expect(body.style.width).toBe('');
    expect(body.className).not.toContain('bodyFrozen');
  });

  it('switches content from store state while keeping Terminal mounted', () => {
    const terminal = sidePanelStore.openTab('terminal', { cwd: '/repo' });
    render(() => (
      <RightToolPanel sessionId="session-1" workspacePath="/repo" />
    ));

    sidePanelStore.setActiveView('files');

    expect(screen.getByTestId('files-view')).toBeTruthy();
    expect(screen.getByTestId('terminal-view').getAttribute('data-active')).toBe('false');

    sidePanelStore.setActiveTab(terminal.id);

    expect(screen.getByTestId('terminal-view').getAttribute('data-active')).toBe('true');
  });

  it('keeps terminal mounted but inactive when the dock is hidden', () => {
    sidePanelStore.openTab('terminal', { cwd: '/repo' });
    render(() => (
      <RightToolPanel sessionId="session-1" workspacePath="/repo" visible={false} />
    ));

    expect(screen.getByTestId('terminal-view')).toBeTruthy();
    expect(screen.getByTestId('terminal-view').getAttribute('data-active')).toBe('false');
  });

  it('renders review content without page back or close actions', () => {
    sidePanelStore.setActiveView('review');
    render(() => (
      <RightToolPanel sessionId="session-1" workspacePath="/repo" />
    ));

    expect(screen.getByTestId('review-view')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Back to tools' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Close tools/i })).toBeNull();
  });
});
