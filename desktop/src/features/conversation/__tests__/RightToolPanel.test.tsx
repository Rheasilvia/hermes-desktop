import { render, screen } from '@solidjs/testing-library';
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
  TerminalPanel: (props: { active: boolean }) => (
    <div data-testid="terminal-view" data-active={props.active ? 'true' : 'false'} />
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
    sidePanelStore.setActiveView('terminal');
    render(() => (
      <RightToolPanel sessionId="session-1" workspacePath="/repo" />
    ));

    expect(screen.getByTestId('terminal-view')).toBeTruthy();
    expect(screen.getByTestId('terminal-view').getAttribute('data-active')).toBe('true');
    expect(sidePanelStore.openTabs()).toEqual(['terminal']);
  });

  it('switches content from store state while keeping Terminal mounted', () => {
    sidePanelStore.setActiveView('terminal');
    render(() => (
      <RightToolPanel sessionId="session-1" workspacePath="/repo" />
    ));

    sidePanelStore.setActiveView('files');

    expect(screen.getByTestId('files-view')).toBeTruthy();
    expect(screen.getByTestId('terminal-view').getAttribute('data-active')).toBe('false');

    sidePanelStore.setActiveView('terminal');

    expect(screen.getByTestId('terminal-view').getAttribute('data-active')).toBe('true');
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
