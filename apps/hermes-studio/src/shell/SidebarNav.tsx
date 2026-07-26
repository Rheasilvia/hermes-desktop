import { A } from '@solidjs/router';
import type { Component } from 'solid-js';
import { For, Show } from 'solid-js';
import { Icon } from '@/ui/atoms/Icon';
import type { IconName } from '@/ui/atoms/Icon';
import styles from './SidebarNav.module.css';

export interface SidebarNavItem {
  href: string;
  label: string;
  icon: IconName;
  active?: boolean;
}

export interface SidebarNavGroup {
  label?: string;
  items: SidebarNavItem[];
}

export interface SidebarNavProps {
  groups: SidebarNavGroup[];
  ariaLabel?: string;
  iconSize?: number;
}

export const SidebarNav: Component<SidebarNavProps> = (props) => (
  <nav class={styles.nav} aria-label={props.ariaLabel}>
    <For each={props.groups}>
      {(group) => (
        <div class={styles.group}>
          <Show when={group.label}>
            <div class={styles.groupLabel}>{group.label}</div>
          </Show>
          <For each={group.items}>
            {(item) => (
              <A
                href={item.href}
                class={`${styles.item} ${item.active ? styles.itemActive : ''}`}
                aria-current={item.active ? 'page' : undefined}
              >
                <Icon name={item.icon} size={props.iconSize ?? 16} />
                <span class={styles.itemText}>{item.label}</span>
              </A>
            )}
          </For>
        </div>
      )}
    </For>
  </nav>
);
