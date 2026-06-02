import type { Component } from 'solid-js';
import { createSignal, createEffect, For, Show } from 'solid-js';
import { Icon } from '@/ui/atoms/Icon.js';
import { fuzzyScore } from '@/utils/fuzzy.js';
import styles from './SlashCommandPanel.module.css';

export interface SlashCommand {
  command: string;
  description: string;
  category?: string;
  icon?: string;
}

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

// Preferred ordering for browse mode; any category not listed here is appended
// alphabetically. Covers the shared registry categories plus dynamic sources.
// Skills lead — they're the most commonly used commands.
const CATEGORY_ORDER = [
  'Skills',
  'Tools & Skills',
  'Session',
  'Configuration',
  'Info',
  'Memory',
  'User commands',
  'Built-in',
];

function getIconName(cmd: SlashCommand): string {
  if (cmd.icon) return cmd.icon;
  const cat = cmd.category ?? 'Built-in';
  return CATEGORY_ICONS[cat] ?? 'terminal';
}

/** A single selectable command row, shared by browse and filter modes. */
const CommandRow: Component<{
  cmd: SlashCommand;
  selected: boolean;
  onSelect: () => void;
  onHover: () => void;
}> = (props) => {
  let ref: HTMLDivElement | undefined;
  // Keep the keyboard-selected row visible: scroll it into view inside the
  // (overflow-y:auto) panel as the selection moves via ArrowUp/ArrowDown.
  createEffect(() => {
    // Optional call: scrollIntoView is unimplemented in jsdom (tests).
    if (props.selected) ref?.scrollIntoView?.({ block: 'nearest' });
  });
  return (
    <div
      ref={ref}
      class={styles.commandRow}
      classList={{ [styles.commandRowSelected]: props.selected }}
      onClick={props.onSelect}
      onMouseEnter={props.onHover}
    >
      <div class={styles.iconWrapper}>
        <Icon name={getIconName(props.cmd) as any} size={12} />
      </div>
      <div class={styles.commandInfo}>
        <span
          class={styles.commandName}
          style={{ 'font-weight': props.selected ? '600' : 'normal' }}
        >
          /{props.cmd.command}
        </span>
        <span class={styles.commandDesc}>{props.cmd.description}</span>
      </div>
    </div>
  );
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

  // Rank by NAME relevance first (fuzzy: exact > prefix > substring > subsequence).
  // Description is only a last-resort *substring* match scored in a low band, so a
  // command whose name matches always outranks a description-only hit, and stray
  // letters scattered through a description don't produce noisy results.
  const scoreCommand = (cmd: SlashCommand, q: string): number => {
    const name = fuzzyScore(q, cmd.command);
    if (name > -Infinity) return name;
    const idx = cmd.description.toLowerCase().indexOf(q.toLowerCase());
    return idx === -1 ? -Infinity : 100 - idx;
  };

  const filteredCommands = (): SlashCommand[] => {
    if (isBrowseMode()) return props.commands;
    const q = props.filter.trim();
    return props.commands
      .map((c) => ({ c, score: scoreCommand(c, q) }))
      .filter((r) => r.score > -Infinity)
      // Best score first; tie-break on shorter then alphabetical command name.
      .sort((a, b) =>
        b.score - a.score ||
        a.c.command.length - b.c.command.length ||
        a.c.command.localeCompare(b.c.command),
      )
      .map((r) => r.c);
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

  // Every category present, ordered: known categories first, then the rest
  // alphabetically — so browse mode shows ALL commands, not a hardcoded subset.
  const orderedCategories = (): string[] => {
    const groups = groupedCommands();
    const known = CATEGORY_ORDER.filter((c) => groups.has(c));
    const rest = [...groups.keys()].filter((c) => !CATEGORY_ORDER.includes(c)).sort();
    return [...known, ...rest];
  };

  // Flat list in the same order as rendered, for keyboard navigation.
  const flatCommands = (): SlashCommand[] => {
    if (isBrowseMode()) {
      const groups = groupedCommands();
      return orderedCategories().flatMap((cat) => groups.get(cat) ?? []);
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

  const renderBrowseMode = () => {
    const groups = groupedCommands();
    const flat = flatCommands();
    return (
      <>
        <div class={styles.browseHeader}>All Commands</div>
        <div class={styles.divider} />
        <For each={orderedCategories()}>
          {(cat) => {
            const cmds = groups.get(cat) ?? [];
            const colors = CATEGORY_COLORS[cat] ?? CATEGORY_COLORS['Built-in'];
            return (
              <>
                <div class={styles.groupHeader}>
                  <span
                    class={styles.categoryBadge}
                    style={{ color: colors.text, background: colors.bg }}
                  >
                    {cat.toUpperCase()}
                  </span>
                </div>
                <For each={cmds}>
                  {(cmd) => {
                    const idx = flat.indexOf(cmd);
                    return (
                      <CommandRow
                        cmd={cmd}
                        selected={idx === selectedIndex()}
                        onSelect={() => props.onSelect(cmd)}
                        onHover={() => setSelectedIndex(idx)}
                      />
                    );
                  }}
                </For>
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
          {(cmd, idx) => (
            <CommandRow
              cmd={cmd}
              selected={idx() === selectedIndex()}
              onSelect={() => props.onSelect(cmd)}
              onHover={() => setSelectedIndex(idx())}
            />
          )}
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
