import type { Component } from 'solid-js';
import { For, createSignal, createMemo } from 'solid-js';
import { Toggle } from '@/components/Toggle.js';
import styles from './ToolsetsGrid.module.css';

import type { IconName } from '@/components/Icon.js';
import { Icon } from '@/components/Icon.js';

interface ToolsetCard {
  name: string;
  icon: IconName;
  tools: string[];
  enabled: boolean;
  category: string;
}

interface ToolsetsGridProps {
  toolsets: ToolsetCard[];
  onToggle: (name: string, enabled: boolean) => void;
  onSelect: (name: string) => void;
}

interface CategoryGroup {
  label: string;
  icon: IconName;
  count: number;
}

export const ToolsetsGrid: Component<ToolsetsGridProps> = (props) => {
  const [activeCategory, setActiveCategory] = createSignal('All');

  const categories = createMemo((): CategoryGroup[] => {
    const counts = new Map<string, number>();
    for (const ts of props.toolsets) {
      counts.set(ts.category, (counts.get(ts.category) ?? 0) + 1);
    }
    const cats: CategoryGroup[] = [{ label: 'All', icon: 'package', count: props.toolsets.length }];
    for (const [label, count] of counts) {
      cats.push({ label, icon: categoryIcon(label), count });
    }
    return cats;
  });

  const filtered = createMemo(() => {
    const cat = activeCategory();
    if (cat === 'All') return props.toolsets;
    return props.toolsets.filter((ts) => ts.category === cat);
  });

  return (
    <div class={styles.toolsetsTab} style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
      <div class={styles.categorySidebar}>
        <For each={categories()}>
          {(cat) => (
            <button
              type="button"
              class={`${styles.categoryItem} ${activeCategory() === cat.label ? styles.categoryItemActive : ''}`}
              onClick={() => setActiveCategory(cat.label)}
            >
              <span class={styles.categoryIcon}>
                <Icon name={cat.icon} size={16} strokeWidth={1.5} />
              </span>
              <span class={styles.categoryLabel}>{cat.label}</span>
              <span class={styles.categoryCount}>{cat.count}</span>
            </button>
          )}
        </For>
      </div>
      <div class={styles.toolsetsMain}>
        <div class={styles.toolsetGrid}>
          <For each={filtered()}>
            {(ts) => (
              <div
                class={styles.toolsetCard}
                onClick={() => props.onSelect(ts.name)}
              >
                <div class={styles.toolsetCardHeader}>
                  <span class={styles.toolsetIcon}>
                    <Icon name={ts.icon} size={20} strokeWidth={1.5} />
                  </span>
                  <div class={styles.toolsetStatus}>
                    <span
                      class={`${styles.toolsetStatusDot} ${ts.enabled ? '' : styles.toolsetStatusDotDisabled}`}
                    />
                    <span class={styles.toolsetStatusLabel}>
                      {ts.enabled ? 'Active' : 'Disabled'}
                    </span>
                  </div>
                </div>
                <div class={styles.toolsetName}>{ts.name}</div>
                <div class={styles.toolsetToolCount}>
                  {ts.tools.length} tool{ts.tools.length !== 1 ? 's' : ''}
                </div>
                <span class={styles.toolsetDecor}>tools</span>
              </div>
            )}
          </For>
        </div>
      </div>
    </div>
  );
};

function categoryIcon(category: string): IconName {
  const icons: Record<string, IconName> = {
    Productivity: 'zap',
    Development: 'wrench',
    Research: 'flask-conical',
    Communication: 'message-circle',
    System: 'settings',
    Custom: 'sparkles',
  };
  return icons[category] ?? 'folder-open';
}
