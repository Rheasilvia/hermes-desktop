export const CHAT_PANE_MIN_WIDTH = 560;
export const TOOLS_DOCK_MIN_WIDTH = 380;
export const SPLIT_SEPARATOR_WIDTH = 1;
export const SPLIT_DRAG_HANDLE_WIDTH = 8;
export const SPLIT_CHROME_WIDTH = SPLIT_SEPARATOR_WIDTH;
export const TOOLS_DOCK_MAX_RATIO = 0.8;
export const TOOLS_DOCK_OVERLAY_HYSTERESIS = 48;

export function toolsDockSplitThreshold(panelWidth: number = TOOLS_DOCK_MIN_WIDTH): number {
  return CHAT_PANE_MIN_WIDTH
    + Math.max(panelWidth, TOOLS_DOCK_MIN_WIDTH)
    + SPLIT_CHROME_WIDTH;
}

export function toolsDockMinimumSplitThreshold(): number {
  return toolsDockSplitThreshold(TOOLS_DOCK_MIN_WIDTH);
}

export function shouldOverlayToolsDock(containerWidth: number, currentlyOverlay = false): boolean {
  if (containerWidth <= 0) return false;

  const minimumSplitWidth = toolsDockMinimumSplitThreshold();
  const exitOverlayWidth = minimumSplitWidth + TOOLS_DOCK_OVERLAY_HYSTERESIS;

  return currentlyOverlay
    ? containerWidth < exitOverlayWidth
    : containerWidth < minimumSplitWidth;
}

export function clampToolsDockWidth(candidateWidth: number, containerWidth: number): number {
  const requestedWidth = Number.isFinite(candidateWidth) ? candidateWidth : TOOLS_DOCK_MIN_WIDTH;
  const safeContainerWidth = Math.max(0, containerWidth);
  const maxByRatio = safeContainerWidth * TOOLS_DOCK_MAX_RATIO;
  const maxByChatPane = safeContainerWidth - CHAT_PANE_MIN_WIDTH - SPLIT_CHROME_WIDTH;
  const maxPanelWidth = Math.max(
    TOOLS_DOCK_MIN_WIDTH,
    Math.min(maxByRatio, maxByChatPane),
  );

  return Math.round(
    Math.min(
      Math.max(requestedWidth, TOOLS_DOCK_MIN_WIDTH),
      maxPanelWidth,
    ),
  );
}
