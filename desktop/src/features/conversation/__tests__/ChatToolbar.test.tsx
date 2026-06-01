import { fireEvent, render, screen } from '@solidjs/testing-library';
import { describe, expect, it, vi } from 'vitest';
import { ChatToolbar } from '../ChatToolbar.js';

describe('ChatToolbar workspace side panel controls', () => {
  it('toggles the side panel from the toolbar button', () => {
    const onToggleSidePanel = vi.fn();
    render(() => (
      <ChatToolbar
        workspacePath="/workspace"
        sidePanelActive={false}
        onToggleSidePanel={onToggleSidePanel}
        onOpenGitView={vi.fn()}
        onToggleDelegationPanel={vi.fn()}
        delegationPanelActive={false}
      />
    ));

    fireEvent.click(screen.getByRole('button', { name: 'Show workspace panel' }));

    expect(onToggleSidePanel).toHaveBeenCalledTimes(1);
  });

  it('opens the Git tab from the More menu without closing the panel itself', () => {
    const onOpenGitView = vi.fn();
    render(() => (
      <ChatToolbar
        workspacePath="/workspace"
        sidePanelActive={true}
        onToggleSidePanel={vi.fn()}
        onOpenGitView={onOpenGitView}
        onToggleDelegationPanel={vi.fn()}
        delegationPanelActive={false}
      />
    ));

    fireEvent.click(screen.getByTitle('More options'));
    fireEvent.click(screen.getByRole('button', { name: /Show Git View/i }));

    expect(onOpenGitView).toHaveBeenCalledTimes(1);
  });
});
