import { render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/stores/git-view.js', () => ({
  gitViewStore: {
    diffData: () => null,
    diffLoading: () => false,
    diffError: () => null,
    activeFileIndex: () => 0,
    reviewData: () => null,
    reviewLoading: () => false,
    reviewError: () => null,
    reviewErrorCode: () => null,
    hasInstallableReviewError: () => false,
    installingTools: () => false,
    retryingReview: () => false,
    selectedReviewPath: () => null,
    actionBusyKey: () => null,
    actionLog: [],
    reviewActionInFlight: () => false,
    currentBranch: () => null,
    defaultBranch: () => null,
    isOnDefaultBranch: () => false,
    createdPrUrl: () => null,
    commitMessage: () => '',
    commitMessageLoading: () => false,
    commitMessageError: () => null,
    commitMessageErrorLabel: () => null,
    hasReviewChanges: () => false,
    reviewShipInfo: () => null,
    reviewFileRailWidth: () => 304,
    setReviewFileRailWidth: vi.fn(),
    resetReviewFileRailWidth: vi.fn(),
    selectDiffFile: vi.fn(),
    fetchDiff: vi.fn(),
    fetchReview: vi.fn(),
    fetchReviewShipInfo: vi.fn(),
    selectReviewFile: vi.fn(),
    stagePath: vi.fn(),
    stageAllReviewChanges: vi.fn(),
    unstagePath: vi.fn(),
    revertPath: vi.fn(),
    revertAllReviewChanges: vi.fn(),
    commitReview: vi.fn(),
    commitThenMaybePush: vi.fn(),
    pushReview: vi.fn(),
    createPullRequest: vi.fn(),
    commitPushAndCreatePullRequest: vi.fn(),
    submitReviewPromptToComposer: vi.fn(),
    setCommitMessage: vi.fn(),
    setCreatedPrUrl: vi.fn(),
    generateCommitMessage: vi.fn(),
    cancelCommitMessageGeneration: vi.fn(),
    installCommandLineTools: vi.fn(),
    retryReview: vi.fn(),
    clearActionLog: vi.fn(),
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
import { chatStore } from '@/stores/chat.js';
import { previewStore } from '@/stores/preview.js';
import { RightToolPanel } from '../RightToolPanel.js';

describe('RightToolPanel', () => {
  beforeEach(() => {
    sidePanelStore.clearTabs();
    sidePanelStore.open();
  });

  afterEach(() => {
    previewStore.clearAll();
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

  it('renders a lightweight preview placeholder without mounting a webview rail', () => {
    sidePanelStore.setActiveView('preview');
    render(() => (
      <RightToolPanel sessionId="session-1" workspacePath="/repo" />
    ));

    expect(screen.getByRole('status', { name: 'No preview selected' })).toBeTruthy();
    expect(screen.queryByText('Preview')).toBeNull();
    expect(document.querySelector('webview')).toBeNull();
  });

  it('renders full plan markdown in the preview pane from chatStore', () => {
    const sid = 'session-plan-preview';
    chatStore.markPromptAccepted(sid, 'turn-plan-preview');
    chatStore.handlePlanDelta(sid, {
      session_id: sid,
      turn_id: 'turn-plan-preview',
      text: '# Implementation Plan\n\n- Inspect current UI\n- Render the full plan',
    });
    const block = chatStore.getLiveState(sid).activityBlocks.find((item) => item.type === 'plan');
    expect(block?.type).toBe('plan');

    previewStore.registerPlan(sid, { blockId: block!.id, label: 'Plan' });
    sidePanelStore.setActiveView('preview');

    render(() => (
      <RightToolPanel sessionId={sid} workspacePath="/repo" />
    ));

    expect(screen.getByRole('heading', { name: 'Implementation Plan' })).toBeTruthy();
    expect(screen.getByText('Render the full plan')).toBeTruthy();
  });

  it('updates plan preview while plan deltas are still streaming', () => {
    const sid = 'session-plan-live-preview';
    chatStore.markPromptAccepted(sid, 'turn-plan-live-preview');
    chatStore.handlePlanDelta(sid, {
      session_id: sid,
      turn_id: 'turn-plan-live-preview',
      text: '# Live Plan\n\n- First line',
    });
    const block = chatStore.getLiveState(sid).activityBlocks.find((item) => item.type === 'plan');
    previewStore.registerPlan(sid, { blockId: block!.id, label: 'Plan' });
    sidePanelStore.setActiveView('preview');

    render(() => (
      <RightToolPanel sessionId={sid} workspacePath="/repo" />
    ));

    expect(screen.getByText('First line')).toBeTruthy();

    chatStore.handlePlanDelta(sid, {
      session_id: sid,
      turn_id: 'turn-plan-live-preview',
      text: '\n- Second live line',
    });

    expect(screen.getByText('Second live line')).toBeTruthy();
  });

  it('shows an unavailable state for stale plan preview references', () => {
    const sid = 'session-plan-stale-preview';
    previewStore.registerPlan(sid, { blockId: 'missing-plan-block', label: 'Plan' });
    sidePanelStore.setActiveView('preview');

    render(() => (
      <RightToolPanel sessionId={sid} workspacePath="/repo" />
    ));

    expect(screen.getByRole('status', { name: 'Plan preview unavailable' })).toBeTruthy();
  });
});
