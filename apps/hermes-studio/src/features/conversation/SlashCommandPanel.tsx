import type { Component } from 'solid-js';
import { createMemo } from 'solid-js';
import { Icon } from '@/ui/atoms/Icon.js';
import { fuzzyScore } from '@/utils/fuzzy.js';
import { CompletionPanel, type CompletionItem } from './composer/CompletionPanel.js';
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

interface SlashCommandPanelProps {
  commands: SlashCommand[];
  filter: string;
  visible: boolean;
  onSelect: (command: SlashCommand) => void;
  onClose: () => void;
}

export const SlashCommandPanel: Component<SlashCommandPanelProps> = (props) => {
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

  const filteredCommands = createMemo((): SlashCommand[] => {
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
  });

  const groupedCommands = createMemo((): Map<string, SlashCommand[]> => {
    const groups = new Map<string, SlashCommand[]>();
    for (const cmd of filteredCommands()) {
      const cat = cmd.category ?? 'Built-in';
      if (!groups.has(cat)) groups.set(cat, []);
      groups.get(cat)!.push(cmd);
    }
    return groups;
  });

  // Every category present, ordered: known categories first, then the rest
  // alphabetically — so browse mode shows ALL commands, not a hardcoded subset.
  const orderedCategories = createMemo((): string[] => {
    const groups = groupedCommands();
    const known = CATEGORY_ORDER.filter((c) => groups.has(c));
    const rest = [...groups.keys()].filter((c) => !CATEGORY_ORDER.includes(c)).sort();
    return [...known, ...rest];
  });

  // Flat list in the same order as rendered, for keyboard navigation.
  const flatCommands = createMemo((): SlashCommand[] => {
    if (isBrowseMode()) {
      const groups = groupedCommands();
      return orderedCategories().flatMap((cat) => groups.get(cat) ?? []);
    }
    return filteredCommands();
  });

  const completionItems = createMemo((): CompletionItem[] => flatCommands().map((cmd) => ({
    id: cmd.command,
    title: `/${cmd.command}`,
    description: cmd.description,
    icon: <Icon name={getIconName(cmd) as any} size={12} />,
    category: isBrowseMode() ? (cmd.category ?? 'Built-in') : undefined,
    data: cmd,
  })));

  return (
    <CompletionPanel
      visible={props.visible}
      header={
        isBrowseMode()
          ? <span class={styles.browseHeader}>All Commands</span>
          : (
            <>
              <Icon name="search" size={12} />
              <span class={styles.panelHeaderText}>
                Commands · {flatCommands().length} result{flatCommands().length !== 1 ? 's' : ''}
              </span>
            </>
          )
      }
      items={completionItems()}
      renderCategory={(category) => {
        const colors = CATEGORY_COLORS[category] ?? CATEGORY_COLORS['Built-in'];
        return (
          <span
            class={styles.categoryBadge}
            style={{ color: colors.text, background: colors.bg }}
          >
            {category.toUpperCase()}
          </span>
        );
      }}
      onSelect={(item) => props.onSelect(item.data as SlashCommand)}
      onClose={props.onClose}
    />
  );
};
