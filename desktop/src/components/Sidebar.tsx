import { Component, For, Show } from 'solid-js';
import { A, useLocation, useNavigate } from '@solidjs/router';
import { ROUTES } from '@/routes';
import { sessionStore } from '@/stores/session.js';
import { Icon } from './Icon';
import { HermesLogo } from './HermesLogo';
import styles from './Sidebar.module.css';

interface NavItem {
  label: string;
  icon: import('./Icon').IconName;
  route: string;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Core',
    items: [
      { label: 'Chat', icon: 'message-square', route: ROUTES.HOME },
      { label: 'Sessions', icon: 'clipboard-list', route: ROUTES.SESSIONS },
    ],
  },
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

  const handleNewSession = async () => {
    const meta = await sessionStore.createSession({});
    if (meta) {
      navigate(ROUTES.HOME);
    }
  };

  return (
    <aside class={styles.sidebar}>
      <div class={styles.header}>
        <div class={styles.brand}>
          <HermesLogo class={styles.brandIcon} />
        </div>
        <button
          class={styles.newChatBtn}
          onClick={handleNewSession}
          title="New chat"
          type="button"
        >
          <Icon name="plus" size={14} />
          <span>New Chat</span>
        </button>
      </div>

      <nav class={styles.nav}>
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

        <Show when={sessionStore.sessions.length > 0}>
          <div class={styles.group}>
            <span class={styles.groupLabel}>Recent</span>
            <For each={sessionStore.sessions.slice(0, 5)}>
              {(session) => (
                <A
                  href={`/sessions/${session.id}`}
                  class={`${styles.navItem} ${location.pathname === `/sessions/${session.id}` ? styles.active : ''}`}
                  title={session.title || 'Untitled session'}
                >
                  <Icon name="message-square" size={14} />
                  <span class={styles.navLabel}>{session.title || 'Untitled'}</span>
                </A>
              )}
            </For>
          </div>
        </Show>
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
