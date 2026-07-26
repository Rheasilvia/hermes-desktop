export const STORAGE_KEYS = {
  desktopSettings: 'hermes.studio.settings',
  theme: 'hermes.studio.theme',
  sidebarCollapsed: 'hermes.studio.sidebar.collapsed',
  sidebarWidth: 'hermes.studio.sidebar.width',
  pinnedSectionOpen: 'hermes.studio.sidebar.pinned.open',
  conversationsSectionOpen: 'hermes.studio.sidebar.conversations.open',
  workspaceGrouping: 'hermes.studio.sidebar.workspace-grouping',
  pinnedSessions: 'hermes.studio.sessions.pinned',
  todoPanelDismissed: 'hermes.studio.todo-panel.dismissed',
  sessionUsage: 'hermes.studio.session.usage',
  sessionPreviews: 'hermes.studio.session-previews.v2',
  composerQueue: 'hermes.studio.composer-queue.v1',
  modelProviders: 'hermes.studio.model.providers.v2',
  modelCatalog: 'hermes.studio.model.catalog.v2',
} as const;

export const MODEL_CACHE_STORAGE_KEYS = [
  STORAGE_KEYS.modelCatalog,
  STORAGE_KEYS.modelProviders,
] as const;

interface StorageRemover {
  removeItem(key: string): void;
}

export function clearModelCacheEntries(storage: StorageRemover): void {
  for (const key of MODEL_CACHE_STORAGE_KEYS) storage.removeItem(key);
}
