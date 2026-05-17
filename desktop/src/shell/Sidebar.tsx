import { Component, For, Show } from 'solid-js';
import { A, useLocation, useNavigate } from '@solidjs/router';
import { ROUTES } from '@/routes';
import { sessionStore } from '@/stores/session.js';
import { Icon } from '@/ui/atoms/Icon';
import { HermesLogo } from '@/ui/organisms/HermesLogo';
import styles from './Sidebar.module.css';

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

  const isActive = (route: string) => {
    if (route === ROUTES.HOME) {
      return location.pathname === '/';
    }
    return location.pathname.startsWith(route);
  };

  const isConversationActive = (sessionId: string) => {
    return location.pathname === `/conversation/${sessionId}`;
  };

  const handleNewConversation = () => {
    navigate(ROUTES.HOME);
  };

  const recentSessions = () => {
    return sessionStore.sessions.slice(0, 10);
  };

  return (
    <aside class={styles.sidebar}>
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
        <Show when={recentSessions().length > 0}>
          <div class={styles.group}>
            <span class={styles.groupLabel}>Conversations</span>
            <For each={recentSessions()}>
              {(session) => (
                <A
                  href={`/conversation/${session.id}`}
                  class={`${styles.navItem} ${isConversationActive(session.id) ? styles.active : ''}`}
                  title={session.title || 'Untitled conversation'}
                >
                  <Icon name="message-square" size={14} />
                  <span class={styles.navLabel}>{session.title || 'Untitled'}</span>
                </A>
              )}
            </For>
            <A
              href={ROUTES.SESSIONS}
              class={`${styles.navItem} ${styles.viewAll}`}
            >
              <Icon name="chevron-right" size={14} />
              <span class={styles.navLabel}>View all</span>
            </A>
          </div>
        </Show>

        <Show when={recentSessions().length === 0}>
          <div class={styles.group}>
            <span class={styles.groupLabel}>Conversations</span>
            <div class={`${styles.navItem} ${styles.emptyHint}`}>
              <Icon name="message-square" size={14} />
              <span class={styles.navLabel}>No conversations yet</span>
            </div>
          </div>
        </Show>

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
      </nav>

      <div class={styles.footer}>
        <A
          href={ROUTES.SETTINGS}
          class={`${styles.navItem} ${isActive(ROUTES.SETTINGS) ? styles.active : ''} ${styles.settingsItem}`}
        >
          <Icon name="settings" size={16} />
          <span class={styles.navLabel}>Settings</span>
        </A>
      </div>
    </aside>
  );
};
