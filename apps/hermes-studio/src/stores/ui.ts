/**
 * UI state store - sidebar, route, connection state, theme.
 * Theme and sidebarCollapsed persist to localStorage.
 */

import { createSignal, createEffect } from 'solid-js';
import type { ConnectionState } from '@/services/gateway/types.js';
import { STORAGE_KEYS } from '@/lib/storage-keys.js';

type Theme = 'dark' | 'light';

/**
 * Operating system the desktop shell is running on. Drives platform-specific
 * chrome such as the title bar (macOS keeps native traffic lights; Windows /
 * Linux render custom window controls). Unknown until `get_platform` resolves.
 */
type Platform = 'macos' | 'windows' | 'linux' | 'unknown';

export const SIDEBAR_MIN_WIDTH = 200;
export const SIDEBAR_MAX_WIDTH = 360;
export const SIDEBAR_DEFAULT_WIDTH = 240;

export function clampSidebarWidth(width: number): number {
  return Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, width));
}

function loadPersistedTheme(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.theme);
    if (stored === 'dark' || stored === 'light') {
      return stored;
    }
  } catch {}
  return 'dark';
}

function loadPersistedSidebar(): boolean {
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.sidebarCollapsed);
    return stored === 'true';
  } catch {}
  return false;
}

function loadPersistedSidebarWidth(): number {
  try {
    const stored = localStorage.getItem(STORAGE_KEYS.sidebarWidth);
    if (stored) {
      const width = parseInt(stored, 10);
      if (!isNaN(width) && width >= SIDEBAR_MIN_WIDTH && width <= SIDEBAR_MAX_WIDTH) {
        return width;
      }
    }
  } catch {}
  return SIDEBAR_DEFAULT_WIDTH;
}

function loadBool(key: string, fallback: boolean): boolean {
  try {
    const stored = localStorage.getItem(key);
    if (stored !== null) return stored === 'true';
  } catch {}
  return fallback;
}

function loadJsonArray(key: string): string[] {
  try {
    const stored = localStorage.getItem(key);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {}
  return [];
}

const [sidebarCollapsed, setSidebarCollapsed] = createSignal(loadPersistedSidebar());
const [sidebarWidth, setSidebarWidthRaw] = createSignal(loadPersistedSidebarWidth());
const [activeRoute, setActiveRoute] = createSignal<string>('/');
const [connectionState, setConnectionState] = createSignal<ConnectionState>('disconnected');
const [theme, setThemeSignal] = createSignal<Theme>(loadPersistedTheme());
const [platform, setPlatformSignal] = createSignal<Platform>('unknown');
const [environmentPanelOpen, setEnvironmentPanelOpenSignal] = createSignal(true);
const [rightToolsOverlay, setRightToolsOverlaySignal] = createSignal(false);

// Sidebar section state — persisted to localStorage
const [pinnedSectionOpen, setPinnedSectionOpen] = createSignal(loadBool(STORAGE_KEYS.pinnedSectionOpen, true));
const [conversationsSectionOpen, setConversationsSectionOpen] = createSignal(loadBool(STORAGE_KEYS.conversationsSectionOpen, true));
const [workspaceGrouping, setWorkspaceGrouping] = createSignal(loadBool(STORAGE_KEYS.workspaceGrouping, false));
const [pinnedSessionIds, setPinnedSessionIds] = createSignal<string[]>(loadJsonArray(STORAGE_KEYS.pinnedSessions));

// Per-session "floating todo panel was dismissed" state — persisted so the panel
// restores to its pre-close visibility on restart instead of re-appearing with
// already-completed todos.
const [todoPanelDismissedIds, setTodoPanelDismissedIds] = createSignal<string[]>(loadJsonArray(STORAGE_KEYS.todoPanelDismissed));

createEffect(() => {
  localStorage.setItem(STORAGE_KEYS.theme, theme());
});

createEffect(() => {
  localStorage.setItem(STORAGE_KEYS.sidebarCollapsed, String(sidebarCollapsed()));
});

createEffect(() => {
  localStorage.setItem(STORAGE_KEYS.sidebarWidth, String(sidebarWidth()));
});

createEffect(() => {
  localStorage.setItem(STORAGE_KEYS.pinnedSectionOpen, String(pinnedSectionOpen()));
});

createEffect(() => {
  localStorage.setItem(STORAGE_KEYS.conversationsSectionOpen, String(conversationsSectionOpen()));
});

createEffect(() => {
  localStorage.setItem(STORAGE_KEYS.workspaceGrouping, String(workspaceGrouping()));
});

createEffect(() => {
  localStorage.setItem(STORAGE_KEYS.pinnedSessions, JSON.stringify(pinnedSessionIds()));
});

createEffect(() => {
  localStorage.setItem(STORAGE_KEYS.todoPanelDismissed, JSON.stringify(todoPanelDismissedIds()));
});

export const uiStore = {
  get sidebarCollapsed() { return sidebarCollapsed(); },
  get sidebarWidth() { return sidebarWidth(); },
  get activeRoute() { return activeRoute(); },
  get connectionState() { return connectionState(); },
  get theme() { return theme(); },
  get platform() { return platform(); },
  get environmentPanelOpen() { return environmentPanelOpen(); },
  get rightToolsOverlay() { return rightToolsOverlay(); },
  get pinnedSectionOpen() { return pinnedSectionOpen(); },
  get conversationsSectionOpen() { return conversationsSectionOpen(); },
  get workspaceGrouping() { return workspaceGrouping(); },
  get pinnedSessionIds() { return pinnedSessionIds(); },

  toggleSidebar() {
    setSidebarCollapsed(!sidebarCollapsed());
  },

  setSidebarCollapsed(collapsed: boolean) {
    setSidebarCollapsed(collapsed);
  },

  setSidebarWidth(width: number) {
    setSidebarWidthRaw(clampSidebarWidth(width));
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

  setPlatform(newPlatform: Platform) {
    setPlatformSignal(newPlatform);
  },

  setEnvironmentPanelOpen(open: boolean) {
    setEnvironmentPanelOpenSignal(open);
  },

  toggleEnvironmentPanel() {
    setEnvironmentPanelOpenSignal(!environmentPanelOpen());
  },

  setRightToolsOverlay(overlay: boolean) {
    setRightToolsOverlaySignal(overlay);
  },

  togglePinnedSection() {
    setPinnedSectionOpen(!pinnedSectionOpen());
  },

  toggleConversationsSection() {
    setConversationsSectionOpen(!conversationsSectionOpen());
  },

  toggleWorkspaceGrouping() {
    setWorkspaceGrouping(!workspaceGrouping());
  },

  pinSession(id: string) {
    const current = pinnedSessionIds();
    if (!current.includes(id)) {
      setPinnedSessionIds([id, ...current]);
    }
  },

  unpinSession(id: string) {
    setPinnedSessionIds(pinnedSessionIds().filter(p => p !== id));
  },

  isPinned(id: string): boolean {
    return pinnedSessionIds().includes(id);
  },

  isTodoPanelDismissed(id: string): boolean {
    return todoPanelDismissedIds().includes(id);
  },

  dismissTodoPanel(id: string) {
    if (!id) return;
    const current = todoPanelDismissedIds();
    if (!current.includes(id)) {
      setTodoPanelDismissedIds([...current, id]);
    }
  },

  restoreTodoPanel(id: string) {
    if (!todoPanelDismissedIds().includes(id)) return;
    setTodoPanelDismissedIds(todoPanelDismissedIds().filter(s => s !== id));
  },
};
