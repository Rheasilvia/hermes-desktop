import type { Component, JSX } from 'solid-js';
import { For, Show, createEffect, createSignal } from 'solid-js';
import styles from '../SlashCommandPanel.module.css';

export interface CompletionItem {
  id: string;
  title: string;
  description?: string;
  icon?: JSX.Element;
  category?: string;
  data?: unknown;
}

interface CompletionPanelProps {
  emptyLabel?: string;
  header: JSX.Element;
  items: CompletionItem[];
  renderCategory?: (category: string) => JSX.Element;
  selectedIndex?: number;
  visible: boolean;
  onClose: () => void;
  onHover?: (index: number) => void;
  onSelect: (item: CompletionItem) => void;
}

export const CompletionPanel: Component<CompletionPanelProps> = (props) => {
  const [selectedIndex, setSelectedIndex] = createSignal(props.selectedIndex ?? 0);

  createEffect(() => {
    if (props.visible) {
      setSelectedIndex(props.selectedIndex ?? 0);
    }
  });

  createEffect(() => {
    props.items.length;
    setSelectedIndex(0);
  });

  const selectIndex = (index: number) => {
    setSelectedIndex(index);
    props.onHover?.(index);
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (!props.visible || props.items.length === 0) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        e.stopPropagation();
        selectIndex((selectedIndex() + 1) % props.items.length);
        break;
      case 'ArrowUp':
        e.preventDefault();
        e.stopPropagation();
        selectIndex((selectedIndex() - 1 + props.items.length) % props.items.length);
        break;
      case 'Enter':
        if (e.shiftKey) return;
        e.preventDefault();
        e.stopPropagation();
        if (props.items[selectedIndex()]) props.onSelect(props.items[selectedIndex()]!);
        break;
      case 'Tab':
        e.preventDefault();
        e.stopPropagation();
        if (props.items[selectedIndex()]) props.onSelect(props.items[selectedIndex()]!);
        break;
      case 'Escape':
        e.preventDefault();
        e.stopPropagation();
        props.onClose();
        break;
    }
  };

  createEffect(() => {
    if (props.visible) {
      document.addEventListener('keydown', handleKeyDown);
    }
    return () => document.removeEventListener('keydown', handleKeyDown);
  });

  return (
    <Show when={props.visible}>
      <div class={styles.panel}>
        <div class={styles.panelHeader}>{props.header}</div>
        <div class={styles.divider} />
        <Show when={props.items.length > 0} fallback={<div class={styles.panelHeader}>{props.emptyLabel ?? 'No results'}</div>}>
          <For each={props.items}>
            {(item, idx) => (
              <>
                <Show when={item.category && (idx() === 0 || props.items[idx() - 1]?.category !== item.category)}>
                  <div class={styles.groupHeader}>
                    {props.renderCategory ? props.renderCategory(item.category!) : item.category}
                  </div>
                </Show>
                <div
                  class={styles.commandRow}
                  classList={{ [styles.commandRowSelected]: idx() === selectedIndex() }}
                  onClick={() => props.onSelect(item)}
                  onMouseEnter={() => selectIndex(idx())}
                >
                  <span class={styles.iconWrapper}>{item.icon}</span>
                  <div class={styles.commandInfo}>
                    <span class={styles.commandName}>{item.title}</span>
                    <Show when={item.description}>
                      <span class={styles.commandDesc}>{item.description}</span>
                    </Show>
                  </div>
                </div>
              </>
            )}
          </For>
        </Show>
      </div>
    </Show>
  );
};
