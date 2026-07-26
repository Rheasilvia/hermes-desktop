export const ENVIRONMENT_OVERLAY_PANEL_WIDTH = 344;
export const ENVIRONMENT_OVERLAY_RESERVED_WIDTH = ENVIRONMENT_OVERLAY_PANEL_WIDTH + 40;
export const ENVIRONMENT_OVERLAY_MIN_CHAT_BODY_WIDTH = 880 + ENVIRONMENT_OVERLAY_RESERVED_WIDTH;

interface EnvironmentOverlayVisibilityInput {
  chatBodyWidth: number | null;
  environmentPanelOpen: boolean;
  rightToolsOverlay: boolean;
}

export function shouldShowEnvironmentOverlay(input: EnvironmentOverlayVisibilityInput): boolean {
  if (!input.environmentPanelOpen || input.rightToolsOverlay) return false;
  return input.chatBodyWidth === null || input.chatBodyWidth >= ENVIRONMENT_OVERLAY_MIN_CHAT_BODY_WIDTH;
}
