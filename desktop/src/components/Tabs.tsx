import type { Component, JSX } from 'solid-js';
import { For, Show, createSignal } from 'solid-js';
import { Icon } from './Icon.js';
import type { IconName } from './Icon.js';
import styles from './Tabs.module.css';

export interface Tab {
  id: string;
  label: string;
  icon?: string;
  iconName?: IconName;
  disabled?: boolean;
}

export interface TabsProps {
  tabs: Tab[];
  activeTab?: string;
  onChange?: (tabId: string) => void;
}

export const Tabs: Component<TabsProps> = (props) => {
  const [activeId, setActiveId] = createSignal(props.activeTab ?? props.tabs[0]?.id);

  const handleClick = (tabId: string, disabled?: boolean) => {
    if (disabled) return;
    setActiveId(tabId);
    props.onChange?.(tabId);
  };

  return (
    <div class={styles.tabs}>
      <For each={props.tabs}>
        {(tab) => (
          <button
            class={`${styles.tab} ${activeId() === tab.id ? styles.active : ''} ${tab.disabled ? styles.disabled : ''}`}
            type="button"
            disabled={tab.disabled}
            aria-disabled={tab.disabled ? 'true' : undefined}
            onClick={() => handleClick(tab.id, tab.disabled)}
          >
            <Show when={tab.iconName}>
              <span class={styles.icon}>
                <Icon name={tab.iconName!} size={16} strokeWidth={1.5} />
              </span>
            </Show>
            <Show when={tab.icon && !tab.iconName}>
              <span class={styles.icon}>{tab.icon}</span>
            </Show>
            <span class={styles.label}>{tab.label}</span>
            <Show when={activeId() === tab.id}>
              <span class={styles.indicator} />
            </Show>
          </button>
        )}
      </For>
    </div>
  );
};
