/**
 * UI state store - sidebar, route, connection state, theme.
 * Theme and sidebarCollapsed persist to localStorage.
 */

import { createSignal, createEffect } from 'solid-js';
import type { ConnectionState } from '@/services/gateway/types.js';

type Theme = 'dark' | 'light' | 'earth';

const STORAGE_KEY_THEME = 'hermes-desktop-theme';
const STORAGE_KEY_SIDEBAR = 'hermes-desktop-sidebar-collapsed';

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

const [sidebarCollapsed, setSidebarCollapsed] = createSignal(loadPersistedSidebar());
const [activeRoute, setActiveRoute] = createSignal<string>('/');
const [connectionState, setConnectionState] = createSignal<ConnectionState>('disconnected');
const [theme, setThemeSignal] = createSignal<Theme>(loadPersistedTheme());

createEffect(() => {
  localStorage.setItem(STORAGE_KEY_THEME, theme());
});

createEffect(() => {
  localStorage.setItem(STORAGE_KEY_SIDEBAR, String(sidebarCollapsed()));
});

export const uiStore = {
  get sidebarCollapsed() { return sidebarCollapsed(); },
  get activeRoute() { return activeRoute(); },
  get connectionState() { return connectionState(); },
  get theme() { return theme(); },

  toggleSidebar() {
    setSidebarCollapsed(!sidebarCollapsed());
  },

  setSidebarCollapsed(collapsed: boolean) {
    setSidebarCollapsed(collapsed);
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
