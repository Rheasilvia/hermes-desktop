import { describe, expect, it } from 'vitest';
import {
  CHAT_PANE_MIN_WIDTH,
  SPLIT_CHROME_WIDTH,
  TOOLS_DOCK_MIN_WIDTH,
  TOOLS_DOCK_OVERLAY_HYSTERESIS,
  clampToolsDockWidth,
  shouldOverlayToolsDock,
  toolsDockMinimumSplitThreshold,
  toolsDockSplitThreshold,
} from '../right-tools-layout.js';

describe('right tools split layout sizing', () => {
  it('keeps the tools dock above its usable minimum width', () => {
    expect(clampToolsDockWidth(240, 1200)).toBe(TOOLS_DOCK_MIN_WIDTH);
  });

  it('keeps enough room for the chat composer when dragging the panel wider', () => {
    const containerWidth = 1200;
    const maxPanelWidth = containerWidth - CHAT_PANE_MIN_WIDTH - SPLIT_CHROME_WIDTH;

    expect(clampToolsDockWidth(900, containerWidth)).toBe(maxPanelWidth);
  });

  it('uses overlay mode when the split cannot satisfy both pane minimums', () => {
    const minimumThreshold = toolsDockMinimumSplitThreshold();

    expect(shouldOverlayToolsDock(minimumThreshold - 1)).toBe(true);
    expect(shouldOverlayToolsDock(minimumThreshold)).toBe(false);
  });

  it('uses hysteresis before leaving overlay mode', () => {
    const exitThreshold = toolsDockMinimumSplitThreshold() + TOOLS_DOCK_OVERLAY_HYSTERESIS;

    expect(shouldOverlayToolsDock(exitThreshold - 1, true)).toBe(true);
    expect(shouldOverlayToolsDock(exitThreshold, true)).toBe(false);
  });

  it('distinguishes preferred dock width from the minimum overlay threshold', () => {
    expect(toolsDockSplitThreshold(500)).toBe(CHAT_PANE_MIN_WIDTH + 500 + SPLIT_CHROME_WIDTH);
    expect(toolsDockMinimumSplitThreshold()).toBe(CHAT_PANE_MIN_WIDTH + TOOLS_DOCK_MIN_WIDTH + SPLIT_CHROME_WIDTH);
  });

  it('does not treat unknown zero-width startup measurements as overlay', () => {
    expect(shouldOverlayToolsDock(0)).toBe(false);
  });
});
