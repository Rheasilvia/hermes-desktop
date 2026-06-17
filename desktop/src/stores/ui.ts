/**
 * UI state store - sidebar, route, connection state, theme.
 * Theme and sidebarCollapsed persist to localStorage.
 */

import { createSignal, createEffect } from 'solid-js';
import type { ConnectionState } from '@/services/gateway/types.js';

type Theme = 'dark' | 'light';

/**
 * Operating system the desktop shell is running on. Drives platform-specific
 * chrome such as the title bar (macOS keeps native traffic lights; Windows /
 * Linux render custom window controls). Unknown until `get_platform` resolves.
 */
type Platform = 'macos' | 'windows' | 'linux' | 'unknown';

const STORAGE_KEY_THEME = 'hermes-desktop-theme';
const STORAGE_KEY_SIDEBAR = 'hermes-desktop-sidebar-collapsed';
const STORAGE_KEY_SIDEBAR_WIDTH = 'hermes-desktop-sidebar-width';
const STORAGE_KEY_PINNED_OPEN = 'hermes-desktop-pinned-open';
const STORAGE_KEY_CONVERSATIONS_OPEN = 'hermes-desktop-conversations-open';
const STORAGE_KEY_WORKSPACE_GROUPING = 'hermes-desktop-workspace-grouping';
const STORAGE_KEY_PINNED_SESSIONS = 'hermes-desktop-pinned-sessions';
const STORAGE_KEY_TODO_PANEL_DISMISSED = 'hermes-desktop-todo-panel-dismissed';

const SIDEBAR_MIN_WIDTH = 200;
const SIDEBAR_MAX_WIDTH = 360;
const SIDEBAR_DEFAULT_WIDTH = 240;

function loadPersistedTheme(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY_THEME);
    if (stored === 'dark' || stored === 'light') {
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

// Sidebar section state — persisted to localStorage
const [pinnedSectionOpen, setPinnedSectionOpen] = createSignal(loadBool(STORAGE_KEY_PINNED_OPEN, true));
const [conversationsSectionOpen, setConversationsSectionOpen] = createSignal(loadBool(STORAGE_KEY_CONVERSATIONS_OPEN, true));
const [workspaceGrouping, setWorkspaceGrouping] = createSignal(loadBool(STORAGE_KEY_WORKSPACE_GROUPING, false));
const [pinnedSessionIds, setPinnedSessionIds] = createSignal<string[]>(loadJsonArray(STORAGE_KEY_PINNED_SESSIONS));

// Per-session "floating todo panel was dismissed" state — persisted so the panel
// restores to its pre-close visibility on restart instead of re-appearing with
// already-completed todos.
const [todoPanelDismissedIds, setTodoPanelDismissedIds] = createSignal<string[]>(loadJsonArray(STORAGE_KEY_TODO_PANEL_DISMISSED));

createEffect(() => {
  localStorage.setItem(STORAGE_KEY_THEME, theme());
});

createEffect(() => {
  localStorage.setItem(STORAGE_KEY_SIDEBAR, String(sidebarCollapsed()));
});

createEffect(() => {
  localStorage.setItem(STORAGE_KEY_SIDEBAR_WIDTH, String(sidebarWidth()));
});

createEffect(() => {
  localStorage.setItem(STORAGE_KEY_PINNED_OPEN, String(pinnedSectionOpen()));
});

createEffect(() => {
  localStorage.setItem(STORAGE_KEY_CONVERSATIONS_OPEN, String(conversationsSectionOpen()));
});

createEffect(() => {
  localStorage.setItem(STORAGE_KEY_WORKSPACE_GROUPING, String(workspaceGrouping()));
});

createEffect(() => {
  localStorage.setItem(STORAGE_KEY_PINNED_SESSIONS, JSON.stringify(pinnedSessionIds()));
});

createEffect(() => {
  localStorage.setItem(STORAGE_KEY_TODO_PANEL_DISMISSED, JSON.stringify(todoPanelDismissedIds()));
});

export const uiStore = {
  get sidebarCollapsed() { return sidebarCollapsed(); },
  get sidebarWidth() { return sidebarWidth(); },
  get activeRoute() { return activeRoute(); },
  get connectionState() { return connectionState(); },
  get theme() { return theme(); },
  get platform() { return platform(); },
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

  setPlatform(newPlatform: Platform) {
    setPlatformSignal(newPlatform);
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
