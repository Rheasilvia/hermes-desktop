import type { Component } from 'solid-js';
import { createSignal, createEffect, For, Show } from 'solid-js';
import { Icon } from '@/ui/atoms/Icon.js';
import styles from './SlashCommandPanel.module.css';

export interface SlashCommand {
  command: string;
  description: string;
  category?: string;
  icon?: string;
}

export type SlashCommandCategory = 'Built-in' | 'Skills' | 'Memory';

const CATEGORY_COLORS: Record<string, { text: string; bg: string }> = {
  'Built-in': { text: 'var(--color-on-surface-dim)', bg: 'var(--color-background-alt)' },
  'Skills': { text: 'var(--color-primary)', bg: 'var(--color-primary-light)' },
  'Memory': { text: 'var(--color-success)', bg: 'var(--color-success-surface)' },
};

const CATEGORY_ICONS: Record<string, string> = {
  'Built-in': 'terminal',
  'Skills': 'zap',
  'Memory': 'brain',
};

interface SlashCommandPanelProps {
  commands: SlashCommand[];
  filter: string;
  visible: boolean;
  onSelect: (command: SlashCommand) => void;
  onClose: () => void;
}

export const SlashCommandPanel: Component<SlashCommandPanelProps> = (props) => {
  const [selectedIndex, setSelectedIndex] = createSignal(0);

  const isBrowseMode = () => props.filter.trim() === '';

  const filteredCommands = (): SlashCommand[] => {
    if (isBrowseMode()) return props.commands;
    const q = props.filter.toLowerCase();
    return props.commands.filter(
      (c) => c.command.toLowerCase().includes(q) || c.description.toLowerCase().includes(q)
    );
  };

  const groupedCommands = (): Map<string, SlashCommand[]> => {
    const groups = new Map<string, SlashCommand[]>();
    for (const cmd of filteredCommands()) {
      const cat = cmd.category ?? 'Built-in';
      if (!groups.has(cat)) groups.set(cat, []);
      groups.get(cat)!.push(cmd);
    }
    return groups;
  };

  const flatCommands = (): SlashCommand[] => {
    if (isBrowseMode()) {
      const result: SlashCommand[] = [];
      const groups = groupedCommands();
      const order: SlashCommandCategory[] = ['Built-in', 'Skills', 'Memory'];
      for (const cat of order) {
        const cmds = groups.get(cat);
        if (cmds) result.push(...cmds);
      }
      return result;
    }
    return filteredCommands();
  };

  createEffect(() => {
    if (props.visible) {
      setSelectedIndex(0);
    }
  });

  createEffect(() => {
    props.filter;
    setSelectedIndex(0);
  });

  const handleKeyDown = (e: KeyboardEvent) => {
    if (!props.visible) return;
    const cmds = flatCommands();
    if (cmds.length === 0) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        e.stopPropagation();
        setSelectedIndex((i) => (i + 1) % cmds.length);
        break;
      case 'ArrowUp':
        e.preventDefault();
        e.stopPropagation();
        setSelectedIndex((i) => (i - 1 + cmds.length) % cmds.length);
        break;
      case 'Enter':
        if (e.shiftKey) return;
        e.preventDefault();
        e.stopPropagation();
        if (cmds[selectedIndex()]) {
          props.onSelect(cmds[selectedIndex()]);
        }
        break;
      case 'Tab':
        e.preventDefault();
        e.stopPropagation();
        if (cmds[selectedIndex()]) {
          props.onSelect(cmds[selectedIndex()]);
        }
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
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  });

  const getIconName = (cmd: SlashCommand): string => {
    if (cmd.icon) return cmd.icon;
    const cat = cmd.category ?? 'Built-in';
    return CATEGORY_ICONS[cat] ?? 'terminal';
  };

  const renderBrowseMode = () => {
    const groups = groupedCommands();
    const order: SlashCommandCategory[] = ['Built-in', 'Skills', 'Memory'];
    let globalIndex = 0;

    return (
      <>
        <div class={styles.browseHeader}>All Commands</div>
        <div class={styles.divider} />
        <For each={order}>
          {(cat, catIdx) => {
            const cmds = groups.get(cat);
            if (!cmds || cmds.length === 0) return null;
            const colors = CATEGORY_COLORS[cat] ?? CATEGORY_COLORS['Built-in'];
            const isLast = catIdx() === order.length - 1;
            return (
              <>
                <div
                  class={styles.browseRow}
                  classList={{ [styles.commandRowSelected]: globalIndex === selectedIndex() }}
                  onClick={() => props.onSelect(cmds[0])}
                  onMouseEnter={() => setSelectedIndex(globalIndex)}
                >
                  <span
                    class={styles.categoryBadge}
                    style={{ color: colors.text, background: colors.bg }}
                  >
                    {cat.toUpperCase()}
                  </span>
                  <span class={styles.categoryCommands}>
                    {cmds.map((c) => `/${c.command}`).join('  ')}
                  </span>
                </div>
                {!isLast && <div class={styles.categoryDivider} />}
                {(() => { globalIndex++; return null; })()}
              </>
            );
          }}
        </For>
      </>
    );
  };

  const renderFilterMode = () => {
    const cmds = flatCommands();
    return (
      <>
        <div class={styles.panelHeader}>
          <Icon name="search" size={12} />
          <span class={styles.panelHeaderText}>
            Commands · {cmds.length} result{cmds.length !== 1 ? 's' : ''}
          </span>
        </div>
        <div class={styles.divider} />
        <For each={cmds}>
          {(cmd, idx) => {
            const isSelected = () => idx() === selectedIndex();
            return (
              <div
                class={styles.commandRow}
                classList={{ [styles.commandRowSelected]: isSelected() }}
                onClick={() => props.onSelect(cmd)}
                onMouseEnter={() => setSelectedIndex(idx())}
              >
                <div class={styles.iconWrapper}>
                  <Icon name={getIconName(cmd) as any} size={12} />
                </div>
                <div class={styles.commandInfo}>
                  <span
                    class={styles.commandName}
                    style={{ 'font-weight': isSelected() ? '600' : 'normal' }}
                  >
                    /{cmd.command}
                  </span>
                  <span class={styles.commandDesc}>{cmd.description}</span>
                </div>
              </div>
            );
          }}
        </For>
      </>
    );
  };

  return (
    <Show when={props.visible}>
      <div class={styles.panel}>
        <Show when={!isBrowseMode()} fallback={renderBrowseMode()}>
          {renderFilterMode()}
        </Show>
      </div>
    </Show>
  );
};
