import type { Component } from 'solid-js';
import { createSignal, createMemo, Show, For, onMount, onCleanup } from 'solid-js';
import { Portal } from 'solid-js/web';
import { commandPaletteOpen, closeCommandPalette, isMac } from '../services/keyboard.js';
import styles from './CommandPalette.module.css';

export interface PaletteAction {
  id: string;
  label: string;
  description: string;
  category: string;
  shortcut: string;
  callback: () => void;
}

interface Props {
  actions: PaletteAction[];
}

function fuzzyMatch(query: string, text: string): boolean {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  let qi = 0;
  for (let i = 0; i < t.length && qi < q.length; i++) {
    if (t[i] === q[qi]) qi++;
  }
  return qi === q.length;
}

function highlightMatch(query: string, text: string): string {
  if (!query) return text;
  const q = query.toLowerCase();
  const result: string[] = [];
  let qi = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (qi < q.length && char.toLowerCase() === q[qi]) {
      result.push(`<mark>${char}</mark>`);
      qi++;
    } else {
      result.push(char);
    }
  }
  return result.join('');
}

export const CommandPalette: Component<Props> = (props) => {
  const [search, setSearch] = createSignal('');
  const [selectedIndex, setSelectedIndex] = createSignal(0);
  let inputRef: HTMLInputElement | undefined;

  const filteredActions = createMemo(() => {
    const q = search().trim();
    if (!q) return props.actions;
    return props.actions.filter(
      (a) => fuzzyMatch(q, a.label) || fuzzyMatch(q, a.description) || fuzzyMatch(q, a.category)
    );
  });

  const reset = () => {
    setSearch('');
    setSelectedIndex(0);
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    const actions = filteredActions();
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, actions.length - 1));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const action = actions[selectedIndex()];
      if (action) {
        closeCommandPalette();
        reset();
        action.callback();
      }
      return;
    }
  };

  const handleBackdropClick = (e: MouseEvent) => {
    if (e.target === e.currentTarget) {
      closeCommandPalette();
      reset();
    }
  };

  const executeAction = (action: PaletteAction) => {
    closeCommandPalette();
    reset();
    action.callback();
  };

  onMount(() => {
    const handleGlobalKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        if (!commandPaletteOpen()) {
          import('../services/keyboard.js').then(({ openCommandPalette }) => {
            openCommandPalette();
          });
        }
      }
    };
    document.addEventListener('keydown', handleGlobalKey);
    onCleanup(() => document.removeEventListener('keydown', handleGlobalKey));
  });

  return (
    <Show when={commandPaletteOpen()}>
      <Portal>
        <div class={styles.overlay} onClick={handleBackdropClick}>
          <div class={styles.palette} role="dialog" aria-modal="true" aria-label="Command palette">
            <div class={styles.searchContainer}>
              <input
                ref={inputRef}
                class={styles.searchInput}
                type="text"
                placeholder="Search commands..."
                value={search()}
                onInput={(e) => {
                  setSearch(e.currentTarget.value);
                  setSelectedIndex(0);
                }}
                onKeyDown={handleKeyDown}
                autofocus
              />
            </div>
            <div class={styles.actionsList}>
              <For each={filteredActions()}>
                {(action, index) => (
                  <button
                    class={`${styles.actionItem} ${index() === selectedIndex() ? styles.selected : ''}`}
                    onClick={() => executeAction(action)}
                    onMouseEnter={() => setSelectedIndex(index())}
                  >
                    <div class={styles.actionMain}>
                      <span
                        class={styles.actionLabel}
                        innerHTML={highlightMatch(search(), action.label)}
                      />
                      <span class={styles.actionCategory}>{action.category}</span>
                    </div>
                    <div class={styles.actionMeta}>
                      <span class={styles.actionDescription}>{action.description}</span>
                      <span class={styles.shortcutHint}>{action.shortcut}</span>
                    </div>
                  </button>
                )}
              </For>
              <Show when={filteredActions().length === 0}>
                <div class={styles.emptyState}>No commands found</div>
              </Show>
            </div>
          </div>
        </div>
      </Portal>
    </Show>
  );
};

export function buildDefaultActions(callbacks: {
  onNavigate: (route: string) => void;
  onNewSession: () => void;
  onToggleSidebar: () => void;
  onCompressContext: () => void;
  onClearHistory: () => void;
  onSwitchModel: () => void;
}): PaletteAction[] {
  const mod = isMac() ? '⌘' : 'Ctrl+';
  return [
    {
      id: 'nav-chat',
      label: 'Chat',
      description: 'Navigate to chat',
      category: 'Navigate',
      shortcut: `${mod}1`,
      callback: () => callbacks.onNavigate('/'),
    },
    {
      id: 'nav-sessions',
      label: 'Sessions',
      description: 'View all sessions',
      category: 'Navigate',
      shortcut: `${mod}2`,
      callback: () => callbacks.onNavigate('/sessions'),
    },
    {
      id: 'nav-memory',
      label: 'Memory',
      description: 'View memory and context',
      category: 'Navigate',
      shortcut: `${mod}3`,
      callback: () => callbacks.onNavigate('/memory'),
    },
    {
      id: 'nav-model',
      label: 'Model',
      description: 'Switch AI model',
      category: 'Navigate',
      shortcut: `${mod}4`,
      callback: () => callbacks.onNavigate('/model'),
    },
    {
      id: 'nav-skills',
      label: 'Skills',
      description: 'Browse available skills',
      category: 'Navigate',
      shortcut: `${mod}5`,
      callback: () => callbacks.onNavigate('/skills'),
    },
    {
      id: 'nav-plugins',
      label: 'Plugins',
      description: 'Manage plugins',
      category: 'Navigate',
      shortcut: `${mod}6`,
      callback: () => callbacks.onNavigate('/plugins'),
    },
    {
      id: 'nav-gateway',
      label: 'Gateway',
      description: 'Manage messaging gateway',
      category: 'Navigate',
      shortcut: `${mod}7`,
      callback: () => callbacks.onNavigate('/gateway'),
    },
    {
      id: 'nav-cron',
      label: 'Cron',
      description: 'Manage scheduled tasks',
      category: 'Navigate',
      shortcut: `${mod}8`,
      callback: () => callbacks.onNavigate('/cron'),
    },
    {
      id: 'nav-settings',
      label: 'Settings',
      description: 'Open application settings',
      category: 'Navigate',
      shortcut: `${mod}9`,
      callback: () => callbacks.onNavigate('/settings'),
    },
    {
      id: 'new-session',
      label: 'New Session',
      description: 'Start a new chat session',
      category: 'Session',
      shortcut: `${mod}N`,
      callback: () => callbacks.onNewSession(),
    },
    {
      id: 'toggle-sidebar',
      label: 'Toggle Sidebar',
      description: 'Show or hide the sidebar',
      category: 'UI',
      shortcut: `${mod}\\`,
      callback: () => callbacks.onToggleSidebar(),
    },
    {
      id: 'compress-context',
      label: 'Compress Context',
      description: 'Compress conversation context to save tokens',
      category: 'Session',
      shortcut: '',
      callback: () => callbacks.onCompressContext(),
    },
    {
      id: 'clear-history',
      label: 'Clear History',
      description: 'Clear the current session messages',
      category: 'Session',
      shortcut: '',
      callback: () => callbacks.onClearHistory(),
    },
    {
      id: 'switch-model',
      label: 'Switch Model',
      description: 'Change the active AI model',
      category: 'Model',
      shortcut: '',
      callback: () => callbacks.onSwitchModel(),
    },
  ];
}
