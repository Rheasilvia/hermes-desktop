/**
 * Compatibility exports for older imports.
 *
 * New code should import runtime config from ./config and desktop-local
 * preferences from ./desktop-settings.
 */

import { configStore } from './config.js';
import { desktopSettingsStore, createDesktopSettingsStore } from './desktop-settings.js';

export { configStore, desktopSettingsStore, createDesktopSettingsStore };

/** @deprecated Import configStore from ./config instead. */
export const settingsStore = configStore;

/** @deprecated Import createDesktopSettingsStore from ./desktop-settings instead. */
export const createSettingsStore = createDesktopSettingsStore;

/** @deprecated Import desktopSettingsStore from ./desktop-settings instead. */
export const newSettingsStore = desktopSettingsStore;
