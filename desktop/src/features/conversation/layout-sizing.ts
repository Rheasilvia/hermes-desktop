export const CHAT_PANE_MIN_WIDTH = 560;
export const WORKSPACE_PANEL_MIN_WIDTH = 380;
export const WORKSPACE_PANEL_MAX_RATIO = 0.8;
export const SPLIT_CHROME_WIDTH = 6;

export function workspacePanelSplitThreshold(): number {
  return CHAT_PANE_MIN_WIDTH + WORKSPACE_PANEL_MIN_WIDTH + SPLIT_CHROME_WIDTH;
}

export function shouldOverlayWorkspacePanel(containerWidth: number): boolean {
  return containerWidth > 0 && containerWidth < workspacePanelSplitThreshold();
}

export function clampWorkspacePanelWidth(candidateWidth: number, containerWidth: number): number {
  const requestedWidth = Number.isFinite(candidateWidth) ? candidateWidth : WORKSPACE_PANEL_MIN_WIDTH;
  const safeContainerWidth = Math.max(0, containerWidth);
  const maxByRatio = safeContainerWidth * WORKSPACE_PANEL_MAX_RATIO;
  const maxByChatPane = safeContainerWidth - CHAT_PANE_MIN_WIDTH - SPLIT_CHROME_WIDTH;
  const maxPanelWidth = Math.max(
    WORKSPACE_PANEL_MIN_WIDTH,
    Math.min(maxByRatio, maxByChatPane),
  );

  return Math.round(
    Math.min(
      Math.max(requestedWidth, WORKSPACE_PANEL_MIN_WIDTH),
      maxPanelWidth,
    ),
  );
}
