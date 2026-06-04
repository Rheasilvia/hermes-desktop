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
      />
    ));

    fireEvent.click(screen.getByRole('button', { name: 'Show workspace panel' }));

    expect(onToggleSidePanel).toHaveBeenCalledTimes(1);
  });

  it('reflects active state when panel is open', () => {
    render(() => (
      <ChatToolbar
        workspacePath="/workspace"
        sidePanelActive={true}
        onToggleSidePanel={vi.fn()}
      />
    ));

    expect(screen.getByRole('button', { name: 'Hide workspace panel' })).toBeTruthy();
  });
});
