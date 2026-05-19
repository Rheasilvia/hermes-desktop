/**
 * UI state store - sidebar, route, connection state, theme.
 * Theme and sidebarCollapsed persist to localStorage.
 */

import { createSignal, createEffect } from 'solid-js';
import type { ConnectionState } from '@/services/gateway/types.js';

type Theme = 'dark' | 'light' | 'earth';

const STORAGE_KEY_THEME = 'hermes-desktop-theme';
const STORAGE_KEY_SIDEBAR = 'hermes-desktop-sidebar-collapsed';
const STORAGE_KEY_SIDEBAR_WIDTH = 'hermes-desktop-sidebar-width';

const SIDEBAR_MIN_WIDTH = 200;
const SIDEBAR_MAX_WIDTH = 360;
const SIDEBAR_DEFAULT_WIDTH = 240;

function loadPersistedTheme(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY_THEME);
    if (stored === 'dark' || stored === 'light' || stored === 'earth') {
      return stored;
    }
  } catch {}
  return 'dark';
}

function loadPersistedSidebar(): boolean {
  try {
    const stored = localStorage.getItem(STORAGE_KEY_SIDEBAR);
    return stored === 'true';
  } catch {}
  return false;
}

function loadPersistedSidebarWidth(): number {
  try {
    const stored = localStorage.getItem(STORAGE_KEY_SIDEBAR_WIDTH);
    if (stored) {
      const width = parseInt(stored, 10);
      if (!isNaN(width) && width >= SIDEBAR_MIN_WIDTH && width <= SIDEBAR_MAX_WIDTH) {
        return width;
      }
    }
  } catch {}
  return SIDEBAR_DEFAULT_WIDTH;
}

const [sidebarCollapsed, setSidebarCollapsed] = createSignal(loadPersistedSidebar());
const [sidebarWidth, setSidebarWidthRaw] = createSignal(loadPersistedSidebarWidth());
const [activeRoute, setActiveRoute] = createSignal<string>('/');
const [connectionState, setConnectionState] = createSignal<ConnectionState>('disconnected');
const [theme, setThemeSignal] = createSignal<Theme>(loadPersistedTheme());

createEffect(() => {
  localStorage.setItem(STORAGE_KEY_THEME, theme());
});

createEffect(() => {
  localStorage.setItem(STORAGE_KEY_SIDEBAR, String(sidebarCollapsed()));
});

createEffect(() => {
  localStorage.setItem(STORAGE_KEY_SIDEBAR_WIDTH, String(sidebarWidth()));
});

export const uiStore = {
  get sidebarCollapsed() { return sidebarCollapsed(); },
  get sidebarWidth() { return sidebarWidth(); },
  get activeRoute() { return activeRoute(); },
  get connectionState() { return connectionState(); },
  get theme() { return theme(); },

  toggleSidebar() {
    setSidebarCollapsed(!sidebarCollapsed());
  },

  setSidebarCollapsed(collapsed: boolean) {
    setSidebarCollapsed(collapsed);
  },

  setSidebarWidth(width: number) {
    const clamped = Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, width));
    setSidebarWidthRaw(clamped);
  },

  setActiveRoute(route: string) {
    setActiveRoute(route);
  },

  setConnectionState(state: ConnectionState) {
    setConnectionState(state);
  },

  setTheme(newTheme: Theme) {
    setThemeSignal(newTheme);
    document.documentElement.dataset.theme = newTheme;
  },
};
