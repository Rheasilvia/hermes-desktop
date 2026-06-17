import { describe, expect, it } from 'vitest';
import {
  CHAT_PANE_MIN_WIDTH,
  SPLIT_CHROME_WIDTH,
  WORKSPACE_PANEL_MIN_WIDTH,
  clampWorkspacePanelWidth,
  shouldOverlayWorkspacePanel,
  workspacePanelSplitThreshold,
} from '../layout-sizing.js';

describe('conversation split layout sizing', () => {
  it('keeps the workspace panel above its usable minimum width', () => {
    expect(clampWorkspacePanelWidth(240, 1200)).toBe(WORKSPACE_PANEL_MIN_WIDTH);
  });

  it('keeps enough room for the chat composer when dragging the panel wider', () => {
    const containerWidth = 1200;
    const maxPanelWidth = containerWidth - CHAT_PANE_MIN_WIDTH - SPLIT_CHROME_WIDTH;

    expect(clampWorkspacePanelWidth(900, containerWidth)).toBe(maxPanelWidth);
  });

  it('uses overlay mode when the split cannot satisfy both pane minimums', () => {
    expect(shouldOverlayWorkspacePanel(workspacePanelSplitThreshold() - 1)).toBe(true);
    expect(shouldOverlayWorkspacePanel(workspacePanelSplitThreshold())).toBe(false);
  });

  it('does not treat unknown zero-width startup measurements as overlay', () => {
    expect(shouldOverlayWorkspacePanel(0)).toBe(false);
  });
});
