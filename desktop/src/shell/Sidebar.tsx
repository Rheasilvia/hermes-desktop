import { Component, For, Show, createSignal, onMount, onCleanup } from 'solid-js';
import { A, useLocation, useNavigate } from '@solidjs/router';
import { ROUTES } from '@/routes';
import { sessionStore } from '@/stores/session.js';
import { chatStore } from '@/stores/chat.js';
import { uiStore } from '@/stores/ui.js';
import { Icon } from '@/ui/atoms/Icon';
import { HermesLogo } from '@/ui/organisms/HermesLogo';
import { Modal } from '@/ui/molecules/Modal.js';
import { Input } from '@/ui/atoms/Input.js';
import { Button } from '@/ui/atoms/Button.js';
import styles from './Sidebar.module.css';

/**
 * Truncate text in the middle, preserving start and end.
 * Example: "Very Long Title Here" → "Very Lo...tle Here"
 */
function middleEllipsis(text: string, maxLength: number = 28): string {
  if (text.length <= maxLength) return text;
  const half = Math.floor((maxLength - 3) / 2); // -3 for "..."
  return `${text.slice(0, half)}...${text.slice(-half)}`;
}

interface NavItem {
  label: string;
  icon: import('@/ui/atoms/Icon').IconName;
  route: string;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Tools & Data',
    items: [
      { label: 'Model', icon: 'bot', route: ROUTES.MODEL },
      { label: 'Skills', icon: 'wrench', route: ROUTES.SKILLS },
      { label: 'Plugins', icon: 'plug', route: ROUTES.PLUGINS },
      { label: 'Memory', icon: 'brain', route: ROUTES.MEMORY },
    ],
  },
  {
    label: 'Communication',
    items: [
      { label: 'Gateway', icon: 'radio', route: ROUTES.GATEWAY },
    ],
  },
  {
    label: 'Automation',
    items: [
      { label: 'Cron', icon: 'clock', route: ROUTES.CRON },
    ],
  },
];

export const Sidebar: Component = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const [renameModalOpen, setRenameModalOpen] = createSignal(false);
  const [renamingSessionId, setRenamingSessionId] = createSignal('');
  const [renameValue, setRenameValue] = createSignal('');
  const [contextMenuOpen, setContextMenuOpen] = createSignal(false);
  const [contextMenuPosition, setContextMenuPosition] = createSignal({ x: 0, y: 0 });
  const [contextMenuSession, setContextMenuSession] = createSignal<{ id: string; title: string } | null>(null);

  const isActive = (route: string) => {
    if (route === ROUTES.HOME) {
      return location.pathname === '/';
    }
    return location.pathname.startsWith(route);
  };

  const isConversationActive = (sessionId: string) => {
    return location.pathname === `/conversation/${sessionId}`;
  };

  const handleNewConversation = async () => {
    try {
      const meta = await sessionStore.createSession({});
      if (meta) {
        navigate(`/conversation/${meta.id}`);
      }
    } catch {
      // silently ignore errors
    }
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
        } catch {
          // silently ignore
        }
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

  const [sessionSearch, setSessionSearch] = createSignal('');

  const filteredSessions = () => {
    const q = sessionSearch().toLowerCase().trim();
    if (!q) return sessionStore.sessions;
    return sessionStore.sessions.filter((s) =>
      (s.title || 'Untitled').toLowerCase().includes(q)
    );
  };

  return (
    <aside class={styles.sidebar} style={{ width: `${uiStore.sidebarWidth}px` }}>
      <div class={styles.resizeHandle}
        onMouseDown={(e) => {
          e.preventDefault();
          const startX = e.clientX;
          const startWidth = uiStore.sidebarWidth;

          const handleMouseMove = (moveEvent: MouseEvent) => {
            const delta = moveEvent.clientX - startX;
            const newWidth = startWidth + delta;
            uiStore.setSidebarWidth(newWidth);
          };

          const handleMouseUp = () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
          };

          document.addEventListener('mousemove', handleMouseMove);
          document.addEventListener('mouseup', handleMouseUp);
        }}
      />
      <div class={styles.header}>
        <div class={styles.brand}>
          <HermesLogo class={styles.brandIcon} />
        </div>
        <button
          class={styles.newChatBtn}
          onClick={handleNewConversation}
          title="New conversation"
          type="button"
        >
          <Icon name="plus" size={14} />
          <span>New Conversation</span>
        </button>
      </div>

      <nav class={styles.nav}>
        {/* ── Conversations: scrollable zone ───────────────────────────── */}
        <div class={styles.conversationsSection}>
          <div class={styles.conversationsHeader}>
            <span class={styles.groupLabel}>Conversations</span>
          </div>
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
          <div class={styles.sessionsList}>
            <Show when={filteredSessions().length > 0}>
              <For each={filteredSessions()}>
                {(session) => (
                  <div class={`${styles.navItem} ${styles.navItemWithMenu} ${isConversationActive(session.id) ? styles.active : ''}`}>
                    <A
                      href={`/conversation/${session.id}`}
                      class={styles.navItemLink}
                      title={session.title || 'Untitled conversation'}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        const menuWidth = 148;
                        const menuHeight = 90;
                        let x = e.clientX;
                        let y = e.clientY;
                        if (x + menuWidth > window.innerWidth) x = window.innerWidth - menuWidth - 8;
                        if (y + menuHeight > window.innerHeight) y = window.innerHeight - menuHeight - 8;
                        setContextMenuPosition({ x, y });
                        setContextMenuSession({ id: session.id, title: session.title || 'Untitled' });
                        setContextMenuOpen(true);
                      }}
                    >
                      <span classList={{
                        [styles.statusDot]: true,
                        [styles.statusDotActive]: chatStore.isStreaming(session.id),
                      }} />
                      <span class={styles.navLabel}>{middleEllipsis(session.title || 'Untitled')}</span>
                    </A>
                  </div>
                )}
              </For>
            </Show>
            <Show when={filteredSessions().length === 0 && sessionSearch()}>
              <div class={`${styles.navItem} ${styles.emptyHint}`}>
                <span class={styles.navLabel}>No results</span>
              </div>
            </Show>
            <Show when={sessionStore.sessions.length === 0}>
              <div class={`${styles.navItem} ${styles.emptyHint}`}>
                <Icon name="message-square" size={14} />
                <span class={styles.navLabel}>No conversations yet</span>
              </div>
            </Show>
          </div>
        </div>

        {/* ── Bottom nav: tools + links ────────────────────────────────── */}
        <div class={styles.bottomNav}>
          <For each={NAV_GROUPS}>
            {(group) => (
              <div class={styles.group}>
                <span class={styles.groupLabel}>{group.label}</span>
                <For each={group.items}>
                  {(item) => (
                    <A
                      href={item.route}
                      class={`${styles.navItem} ${isActive(item.route) ? styles.active : ''}`}
                    >
                      <Icon name={item.icon} size={16} />
                      <span class={styles.navLabel}>{item.label}</span>
                    </A>
                  )}
                </For>
              </div>
            )}
          </For>
        </div>
      </nav>

      <Show when={contextMenuOpen() && contextMenuSession()}>
        <div
          data-context-menu
          class={styles.contextDropdown}
          style={{
            left: `${contextMenuPosition().x}px`,
            top: `${contextMenuPosition().y}px`,
          }}
        >
          <button
            type="button"
            class={styles.dropdownItem}
            onClick={() => {
              const s = contextMenuSession()!;
              handleOpenRename(s.id, s.title);
            }}
          >
            <Icon name="file-text" size={13} />
            <span>Rename</span>
          </button>
          <div class={styles.dropdownDivider} />
          <button
            type="button"
            class={`${styles.dropdownItem} ${styles.dropdownDanger}`}
            onClick={() => {
              const s = contextMenuSession()!;
              handleDeleteSession(s.id);
              closeContextMenu();
            }}
          >
            <Icon name="x" size={13} />
            <span>Delete</span>
          </button>
        </div>
      </Show>

      <div class={styles.footer}>
        <A
          href={ROUTES.SETTINGS}
          class={`${styles.navItem} ${isActive(ROUTES.SETTINGS) ? styles.active : ''} ${styles.settingsItem}`}
        >
          <Icon name="settings" size={16} />
          <span class={styles.navLabel}>Settings</span>
        </A>
      </div>

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
