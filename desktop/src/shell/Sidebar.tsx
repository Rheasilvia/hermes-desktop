import { Component, For, Show, createSignal, onMount, onCleanup, createMemo, JSX } from 'solid-js';
import { A, useLocation, useNavigate } from '@solidjs/router';
import { ROUTES } from '@/routes';
import { sessionStore } from '@/stores/session.js';
import { chatStore } from '@/stores/chat.js';
import { uiStore } from '@/stores/ui.js';
import { Icon } from '@/ui/atoms/Icon';
import type { IconName } from '@/ui/atoms/Icon';
import { Modal } from '@/ui/molecules/Modal.js';
import { Input } from '@/ui/atoms/Input.js';
import { Button } from '@/ui/atoms/Button.js';
import { APP_VERSION, APP_COMMIT } from '@/version';
import { SidebarNav, type SidebarNavGroup } from './SidebarNav';
import styles from './Sidebar.module.css';

/**
 * Truncate text in the middle, preserving start and end.
 * Example: "Very Long Title Here" → "Very Lo...tle Here"
 */
function middleEllipsis(text: string, maxLength: number = 28): string {
  if (text.length <= maxLength) return text;
  const half = Math.floor((maxLength - 3) / 2);
  return `${text.slice(0, half)}...${text.slice(-half)}`;
}

/** Extract the base directory name from a path. */
function baseName(path: string): string {
  return path
    .replace(/[/\\]+$/, '')
    .split(/[/\\]/)
    .filter(Boolean)
    .pop() ?? path;
}

// ─── Context menu action ────────────────────────────────────────────────────────

interface ContextAction {
  label: string;
  icon: IconName;
  danger?: boolean;
  action: () => void;
}

// ─── Component ──────────────────────────────────────────────────────────────────

export const Sidebar: Component = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const [renameModalOpen, setRenameModalOpen] = createSignal(false);
  const [renamingSessionId, setRenamingSessionId] = createSignal('');
  const [renameValue, setRenameValue] = createSignal('');
  const [contextMenuOpen, setContextMenuOpen] = createSignal(false);
  const [contextMenuPosition, setContextMenuPosition] = createSignal({ x: 0, y: 0 });
  const [contextMenuSession, setContextMenuSession] = createSignal<{ id: string; title: string } | null>(null);
  const [sessionSearch, setSessionSearch] = createSignal('');

  // ── Window drag region (sidebar top strip) ──────────────────────────────────
  // The strip carries `data-tauri-drag-region`; Tauri's built-in drag script
  // handles BOTH drag-move AND double-click → maximize/restore natively. We
  // intentionally add no JS handlers here — a JS onDblClick → toggleMaximize()
  // would double-toggle against the native behavior (maximize then restore =
  // "snaps back"). All Tauri APIs stay inert off-Tauri (browser/vite preview).

  // ── Route helpers ─────────────────────────────────────────────────────────────

  const isActive = (route: string) => {
    if (route === ROUTES.HOME) return location.pathname === '/';
    return location.pathname.startsWith(route);
  };

  const isConversationActive = (sessionId: string) =>
    location.pathname === `/conversation/${sessionId}`;

  // ── Session CRUD handlers ─────────────────────────────────────────────────────

  const handleNewConversation = async () => {
    try {
      const meta = await sessionStore.createSession({});
      if (meta) navigate(`/conversation/${meta.id}`);
    } catch { /* noop */ }
  };

  const handleDeleteSession = async (id: string) => {
    const wasActive = location.pathname === `/conversation/${id}`;
    await sessionStore.deleteSession(id);
    if (wasActive) {
      const remaining = sessionStore.sessions;
      if (remaining.length > 0) {
        navigate(`/conversation/${remaining[0].id}`);
      } else {
        try {
          const meta = await sessionStore.createSession({});
          if (meta) navigate(`/conversation/${meta.id}`);
        } catch { /* noop */ }
      }
    }
  };

  const handleArchiveSession = async (id: string) => {
    const wasActive = location.pathname === `/conversation/${id}`;
    await sessionStore.archiveSession(id);
    if (wasActive) {
      const remaining = sessionStore.sessions;
      if (remaining.length > 0) {
        navigate(`/conversation/${remaining[0].id}`);
      } else {
        try {
          const meta = await sessionStore.createSession({});
          if (meta) navigate(`/conversation/${meta.id}`);
        } catch { /* noop */ }
      }
    }
  };

  const handleOpenRename = (sessionId: string, currentTitle: string) => {
    setRenamingSessionId(sessionId);
    setRenameValue(currentTitle);
    setRenameModalOpen(true);
    setContextMenuOpen(false);
  };

  const handleRenameSubmit = async () => {
    const title = renameValue().trim();
    if (title) {
      await sessionStore.renameSession(renamingSessionId(), title);
    }
    setRenameModalOpen(false);
  };

  // ── Pin operations ────────────────────────────────────────────────────────────

  const handlePinSession = (id: string) => {
    if (uiStore.isPinned(id)) {
      uiStore.unpinSession(id);
    } else {
      uiStore.pinSession(id);
    }
    setContextMenuOpen(false);
  };

  const isSessionPinned = (id: string) => uiStore.isPinned(id);

  // ── Context menu ──────────────────────────────────────────────────────────────

  const closeContextMenu = () => {
    setContextMenuOpen(false);
    setContextMenuSession(null);
  };

  const handleClickOutside = (e: MouseEvent) => {
    if (contextMenuOpen() && !(e.target as HTMLElement).closest('[data-context-menu]')) {
      closeContextMenu();
    }
  };

  const handleEscape = (e: KeyboardEvent) => {
    if (e.key === 'Escape') closeContextMenu();
  };

  onMount(() => {
    document.addEventListener('click', handleClickOutside, true);
    document.addEventListener('keydown', handleEscape);
  });

  onCleanup(() => {
    document.removeEventListener('click', handleClickOutside, true);
    document.removeEventListener('keydown', handleEscape);
  });

  // ── Derived lists ─────────────────────────────────────────────────────────────

  const allSessions = () => sessionStore.sessions;

  const pinnedSessions = createMemo(() => {
    const pinned = uiStore.pinnedSessionIds;
    return allSessions().filter(s => pinned.includes(s.id));
  });

  const unpinnedSessions = createMemo(() => {
    const pinned = uiStore.pinnedSessionIds;
    return allSessions().filter(s => !pinned.includes(s.id));
  });

  const filteredSessions = () => {
    const q = sessionSearch().toLowerCase().trim();
    if (!q) return allSessions();
    return allSessions().filter((s) =>
      (s.title || 'Untitled').toLowerCase().includes(q),
    );
  };

  // ── Workspace grouping ────────────────────────────────────────────────────────

  const workspaceGroups = createMemo(() => {
    const sessions = unpinnedSessions();
    if (!uiStore.workspaceGrouping) return null;

    const groups = new Map<string, typeof sessions>();
    for (const s of sessions) {
      const dir = s.cwd ? baseName(s.cwd) : 'No workspace';
      if (!groups.has(dir)) groups.set(dir, []);
      groups.get(dir)!.push(s);
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
  });

  // ── Context menu actions ──────────────────────────────────────────────────────

  const contextActions = (): ContextAction[] => {
    const s = contextMenuSession();
    if (!s) return [];
    const pinned = isSessionPinned(s.id);
    return [
      {
        label: pinned ? 'Unpin' : 'Pin',
        icon: 'pin',
        action: () => handlePinSession(s.id),
      },
      {
        label: 'Copy ID',
        icon: 'copy',
        action: () => {
          void navigator.clipboard.writeText(s.id).catch(() => {});
          closeContextMenu();
        },
      },
      {
        label: 'Rename',
        icon: 'pencil',
        action: () => handleOpenRename(s.id, s.title),
      },
      {
        label: 'Archive',
        icon: 'archive',
        action: () => {
          handleArchiveSession(s.id);
          closeContextMenu();
        },
      },
      {
        label: 'Delete',
        icon: 'trash-2',
        danger: true,
        action: () => {
          handleDeleteSession(s.id);
          closeContextMenu();
        },
      },
    ];
  };

  // ── Search ────────────────────────────────────────────────────────────────────

  const showSearch = () => allSessions().length > 0;

  const bottomNavGroups = (): SidebarNavGroup[] => [
    {
      items: [
        {
          href: ROUTES.SETTINGS_GENERAL,
          label: 'Settings',
          icon: 'settings',
          active: isActive(ROUTES.SETTINGS),
        },
      ],
    },
  ];

  // ── Render helpers ────────────────────────────────────────────────────────────

  const renderSessionRow = (session: { id: string; title: string }) => (
    <div
      class={`${styles.sessionRow} ${isConversationActive(session.id) ? styles.sessionRowActive : ''}`}
    >
      <A
        href={`/conversation/${session.id}`}
        class={styles.sessionRowLink}
        title={session.title || 'Untitled'}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          const menuWidth = 148;
          const menuHeight = 190;
          let x = e.clientX;
          let y = e.clientY;
          if (x + menuWidth > window.innerWidth) x = window.innerWidth - menuWidth - 8;
          if (y + menuHeight > window.innerHeight) y = window.innerHeight - menuHeight - 8;
          setContextMenuPosition({ x, y });
          setContextMenuSession({ id: session.id, title: session.title || 'Untitled' });
          setContextMenuOpen(true);
        }}
      >
        <span
          classList={{
            [styles.statusDot]: true,
            [styles.statusDotActive]: chatStore.isStreaming(session.id),
          }}
        />
        <span class={styles.sessionTitle}>{middleEllipsis(session.title || 'Untitled')}</span>
      </A>
    </div>
  );

  const renderSectionHeader = (
    label: string,
    count: number,
    open: boolean,
    onToggle: () => void,
    extraAction?: JSX.Element,
  ) => (
    <button
      class={styles.sectionHeader}
      onClick={onToggle}
      type="button"
    >
      <span
        class={`${styles.disclosureCaret} ${open ? styles.disclosureCaretOpen : ''}`}
        aria-hidden="true"
      >
        <Icon name="chevron-right" size={12} />
      </span>
      <span class={styles.sectionLabel}>{label}</span>
      <span class={styles.sectionCount}>{count}</span>
      {extraAction}
    </button>
  );

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <aside class={styles.sidebar}>
      {/* ── Window drag strip ───────────────────────────────────────────── */}
      {/* Titlebar-height strip aligned with the workspace TitleBar so the
          sidebar's top edge can drag-move and double-click-maximize the
          frameless window. It carries `data-tauri-drag-region`, and Tauri's
          built-in script handles BOTH the drag and the double-click →
          maximize/restore natively. We deliberately do NOT add our own
          onDblClick → toggleMaximize() here: doing so double-toggles
          (native maximize + JS restore), which is the "maximize then snaps
          back" bug. The strip overlays only the sidebar's top padding
          (var(--titlebar-height)), so it never overlaps the New Chat button
          or the session list beneath it. */}
      <div
        class={styles.dragStrip}
        data-tauri-drag-region
        aria-hidden="true"
      />

      {/* ── New Chat button ────────────────────────────────────────────── */}
      <div class={styles.topBar}>
        <button
          class={styles.newChatBtn}
          onClick={handleNewConversation}
          title="New conversation (⌘N)"
          type="button"
        >
          <Icon name="plus" size={14} />
          <span>New Chat</span>
          <span class={styles.shortcutHint}>⌘N</span>
        </button>
      </div>

      {/* ── Search ─────────────────────────────────────────────────────── */}
      <Show when={showSearch()}>
        <div class={styles.searchWrapper}>
          <Icon name="search" size={12} class={styles.searchIcon} />
          <input
            class={styles.searchInput}
            type="text"
            placeholder="Search…"
            value={sessionSearch()}
            onInput={(e) => setSessionSearch(e.currentTarget.value)}
          />
          <Show when={sessionSearch()}>
            <button
              class={styles.searchClear}
              type="button"
              onClick={() => setSessionSearch('')}
              title="Clear search"
            >
              <Icon name="x" size={10} />
            </button>
          </Show>
        </div>
      </Show>

      {/* ── Session list ────────────────────────────────────────────────── */}
      <div class={styles.sectionsScroll}>
        <Show when={sessionSearch()}>
          {/* Search mode: flat filtered list */}
          <div class={styles.section}>
            {renderSectionHeader('Results', filteredSessions().length, true, () => {})}
            <div class={styles.sectionContent}>
              <For each={filteredSessions()}>
                {(session) => renderSessionRow(session)}
              </For>
            </div>
            <Show when={filteredSessions().length === 0}>
              <div class={styles.emptyHint}>No results</div>
            </Show>
          </div>
        </Show>

        <Show when={!sessionSearch()}>
          {/* ── Pinned section ──────────────────────────────────────────── */}
          <Show when={pinnedSessions().length > 0}>
            <div class={styles.section}>
              {renderSectionHeader(
                'Pinned',
                pinnedSessions().length,
                uiStore.pinnedSectionOpen,
                () => uiStore.togglePinnedSection(),
              )}
              <Show when={uiStore.pinnedSectionOpen}>
                <div class={`${styles.sectionContent} ${styles.sectionContentAnimate}`}>
                  <For each={pinnedSessions()}>
                    {(session) => renderSessionRow(session)}
                  </For>
                </div>
              </Show>
            </div>
          </Show>

          {/* ── Conversations section ────────────────────────────────────── */}
          <Show when={allSessions().length > 0}>
            <div class={styles.section}>
              {renderSectionHeader(
                uiStore.workspaceGrouping ? 'Projects' : 'Conversations',
                allSessions().length,
                uiStore.conversationsSectionOpen,
                () => uiStore.toggleConversationsSection(),
                <button
                  class={`${styles.groupToggle} ${uiStore.workspaceGrouping ? styles.groupToggleActive : ''}`}
                  onClick={(e) => { e.stopPropagation(); uiStore.toggleWorkspaceGrouping(); }}
                  title={uiStore.workspaceGrouping ? 'Ungroup' : 'Group by workspace'}
                  type="button"
                >
                  <Icon name="folder" size={12} />
                </button>,
              )}
              <Show when={uiStore.conversationsSectionOpen}>
                <div class={`${styles.sectionContent} ${styles.sectionContentAnimate}`}>
                  <Show
                    when={!uiStore.workspaceGrouping}
                    fallback={
                      /* Workspace-grouped view */
                      <For each={workspaceGroups()}>
                        {([group, sessions]) => (
                          <div class={styles.workspaceGroup}>
                            <div class={styles.workspaceGroupLabel}>
                              <Icon name="folder" size={11} />
                              <span class={styles.workspaceGroupName}>{group}</span>
                              <span class={styles.workspaceGroupCount}>{sessions.length}</span>
                            </div>
                            <For each={sessions}>
                              {(session) => renderSessionRow(session)}
                            </For>
                          </div>
                        )}
                      </For>
                    }
                  >
                    {/* Flat list */}
                    <For each={unpinnedSessions()}>
                      {(session) => renderSessionRow(session)}
                    </For>
                  </Show>
                </div>
              </Show>
            </div>
          </Show>

          {/* ── Empty state ──────────────────────────────────────────────── */}
          <Show when={allSessions().length === 0}>
            <div class={styles.emptyState}>
              <Icon name="message-square" size={18} />
              <span>No conversations yet</span>
            </div>
          </Show>
        </Show>
      </div>

      {/* ── Bottom: Settings ────────────────────────────────────────────── */}
      <div class={styles.bottomBar}>
        <SidebarNav groups={bottomNavGroups()} />
        <div
          class={styles.versionLabel}
          title={`Version ${APP_VERSION} (${APP_COMMIT})`}
        >
          v{APP_VERSION} · {APP_COMMIT}
        </div>
      </div>

      {/* ── Context menu ────────────────────────────────────────────────── */}
      <Show when={contextMenuOpen() && contextMenuSession()}>
        <div
          data-context-menu
          class={styles.contextDropdown}
          style={{
            left: `${contextMenuPosition().x}px`,
            top: `${contextMenuPosition().y}px`,
          }}
        >
          <For each={contextActions()}>
            {(action) => (
              <button
                type="button"
                class={`${styles.dropdownItem} ${action.danger ? styles.dropdownDanger : ''}`}
                onClick={action.action}
              >
                <Icon name={action.icon} size={13} />
                <span>{action.label}</span>
              </button>
            )}
          </For>
        </div>
      </Show>

      {/* ── Rename modal ────────────────────────────────────────────────── */}
      <Modal
        open={renameModalOpen()}
        title="Rename conversation"
        onClose={() => setRenameModalOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setRenameModalOpen(false)}>Cancel</Button>
            <Button onClick={handleRenameSubmit} disabled={!renameValue().trim()}>Save</Button>
          </>
        }
      >
        <Input
          value={renameValue()}
          placeholder="Conversation name"
          onInput={(e) => setRenameValue(e.currentTarget.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleRenameSubmit(); }}
        />
      </Modal>
    </aside>
  );
};
