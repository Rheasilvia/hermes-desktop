import { describe, expect, it } from 'vitest';
import {
  ENVIRONMENT_OVERLAY_MIN_CHAT_BODY_WIDTH,
  ENVIRONMENT_OVERLAY_PANEL_WIDTH,
  ENVIRONMENT_OVERLAY_RESERVED_WIDTH,
  shouldShowEnvironmentOverlay,
} from '../environmentOverlay.js';

describe('environment overlay policy', () => {
  it('keeps the Codex-like panel and reservation width constants centralized', () => {
    expect(ENVIRONMENT_OVERLAY_PANEL_WIDTH).toBe(344);
    expect(ENVIRONMENT_OVERLAY_RESERVED_WIDTH).toBe(384);
    expect(ENVIRONMENT_OVERLAY_MIN_CHAT_BODY_WIDTH).toBe(1264);
  });

  it('allows the overlay while the chat body is unmeasured or wide enough', () => {
    expect(shouldShowEnvironmentOverlay({
      chatBodyWidth: null,
      environmentPanelOpen: true,
      rightToolsOverlay: false,
    })).toBe(true);

    expect(shouldShowEnvironmentOverlay({
      chatBodyWidth: ENVIRONMENT_OVERLAY_MIN_CHAT_BODY_WIDTH,
      environmentPanelOpen: true,
      rightToolsOverlay: false,
    })).toBe(true);
  });

  it('hides the overlay when closed, tools overlay is active, or the chat body is narrow', () => {
    expect(shouldShowEnvironmentOverlay({
      chatBodyWidth: ENVIRONMENT_OVERLAY_MIN_CHAT_BODY_WIDTH,
      environmentPanelOpen: false,
      rightToolsOverlay: false,
    })).toBe(false);

    expect(shouldShowEnvironmentOverlay({
      chatBodyWidth: ENVIRONMENT_OVERLAY_MIN_CHAT_BODY_WIDTH,
      environmentPanelOpen: true,
      rightToolsOverlay: true,
    })).toBe(false);

    expect(shouldShowEnvironmentOverlay({
      chatBodyWidth: ENVIRONMENT_OVERLAY_MIN_CHAT_BODY_WIDTH - 1,
      environmentPanelOpen: true,
      rightToolsOverlay: false,
    })).toBe(false);
  });
});
