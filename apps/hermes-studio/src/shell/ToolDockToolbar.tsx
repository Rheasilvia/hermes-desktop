import {
  Component,
  For,
  Show,
  createEffect,
  createSignal,
  onCleanup,
  onMount,
} from 'solid-js';
import { isTauri } from '@tauri-apps/api/core';
import { Icon, type IconName } from '@/ui/atoms/Icon';
import { sidePanelStore, type ToolTab, type ToolTabView } from '@/stores/side-panel';
import styles from './TitleBar.module.css';

interface ToolTabItem {
  view: ToolTabView;
  title: string;
  description: string;
  icon: IconName;
}

const TOOL_TAB_ITEMS: ToolTabItem[] = [
  {
    view: 'review',
    title: 'Review',
    description: 'Inspect current git changes',
    icon: 'clipboard-list',
  },
  {
    view: 'terminal',
    title: 'Terminal',
    description: 'Open a live shell in this workspace',
    icon: 'terminal',
  },
  {
    view: 'files',
    title: 'Open file',
    description: 'Browse files in the selected workspace',
    icon: 'folder-open',
  },
  {
    view: 'delegation',
    title: 'Delegation',
    description: 'Track subagents for this conversation',
    icon: 'users',
  },
];

const toolTabItemForView = (view: ToolTabView): ToolTabItem =>
  TOOL_TAB_ITEMS.find(item => item.view === view) ?? TOOL_TAB_ITEMS[0]!;

interface ToolDockToolbarProps {
  terminalCwd?: string | null;
  terminalTitle?: string | null;
}

type WindowHandle = {
  startDragging: () => Promise<void>;
  toggleMaximize: () => Promise<void>;
};

async function resolveWindow(): Promise<WindowHandle | null> {
  if (!isTauri()) return null;
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  return getCurrentWindow() as unknown as WindowHandle;
}

function blockDrag(event: MouseEvent) {
  event.stopPropagation();
}

function isInteractiveTitleBarTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement
    && target.closest('button, a, input, textarea, select, [role="button"], [role="tab"], [role="menuitem"]') != null;
}

export const ToolDockToolbar: Component<ToolDockToolbarProps> = (props) => {
  const [toolMenuOpen, setToolMenuOpen] = createSignal(false);
  const [editingTabId, setEditingTabId] = createSignal<string | null>(null);
  const [editingTitle, setEditingTitle] = createSignal('');
  let toolMenuRoot: HTMLDivElement | undefined;
  let renameInput: HTMLInputElement | undefined;

  const tabTitle = (tab: ToolTab) => tab.title.trim() || toolTabItemForView(tab.kind).title;

  const startRenamingTab = (tab: ToolTab) => {
    if (tab.kind !== 'terminal') return;
    setEditingTabId(tab.id);
    setEditingTitle(tabTitle(tab));
    queueMicrotask(() => {
      renameInput?.focus();
      renameInput?.select();
    });
  };

  const cancelRenamingTab = () => {
    setEditingTabId(null);
    setEditingTitle('');
  };

  const commitRenamingTab = (tab: ToolTab) => {
    if (editingTabId() !== tab.id) return;
    const title = editingTitle().trim();
    if (title) {
      sidePanelStore.renameTab(tab.id, title);
    }
    cancelRenamingTab();
  };

  const handleDocumentPointerDown = (event: PointerEvent) => {
    if (!toolMenuOpen()) return;
    const target = event.target;
    if (target instanceof Node && toolMenuRoot?.contains(target)) return;
    setToolMenuOpen(false);
  };

  const handleDocumentKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      setToolMenuOpen(false);
    }
  };

  onMount(() => {
    document.addEventListener('pointerdown', handleDocumentPointerDown);
    document.addEventListener('keydown', handleDocumentKeyDown);
    onCleanup(() => {
      document.removeEventListener('pointerdown', handleDocumentPointerDown);
      document.removeEventListener('keydown', handleDocumentKeyDown);
    });
  });

  const handleToggleToolsDock = () => {
    const shouldOpenToolMenu = !sidePanelStore.isOpen() && sidePanelStore.openTabs().length === 0;
    sidePanelStore.toggle();
    if (shouldOpenToolMenu) {
      setToolMenuOpen(true);
    }
  };
  const handleStartDragging = async (event: MouseEvent) => {
    if (event.button !== 0) return;
    if (isInteractiveTitleBarTarget(event.target)) return;

    const win = await resolveWindow();
    try { await win?.startDragging(); } catch { /* ignore */ }
  };
  const handleTitleBarDoubleClick = async (event: MouseEvent) => {
    if (event.button !== 0) return;
    if (isInteractiveTitleBarTarget(event.target)) return;
    event.preventDefault();

    const win = await resolveWindow();
    try { await win?.toggleMaximize(); } catch { /* ignore */ }
  };

  const activateToolTab = (item: ToolTabItem) => {
    sidePanelStore.openTab(item.view, item.view === 'terminal'
      ? { cwd: props.terminalCwd, title: props.terminalTitle }
      : undefined);
    setToolMenuOpen(false);
  };

  createEffect(() => {
    if (!sidePanelStore.isOpen()) {
      setToolMenuOpen(false);
    }
  });

  createEffect(() => {
    if (!sidePanelStore.toolMenuOpenRequested()) return;
    if (!sidePanelStore.isOpen()) return;
    setToolMenuOpen(true);
    sidePanelStore.clearToolMenuOpenRequest();
  });

  const renderToolTab = (tab: ToolTab) => {
    const item = toolTabItemForView(tab.kind);
    const selected = () => sidePanelStore.activeTabId() === tab.id;
    const title = () => tabTitle(tab);
    const closeLabel = `Close ${title()} tab`;
    const editing = () => editingTabId() === tab.id;
    return (
      <div
        class={styles.toolTabItem}
        classList={{ [styles.toolTabActive]: selected() }}
        title={title()}
        onMouseDown={blockDrag}
      >
        <Show
          when={editing()}
          fallback={(
            <button
              type="button"
              role="tab"
              class={styles.toolTab}
              aria-label={title()}
              aria-selected={selected()}
              onMouseDown={blockDrag}
              onClick={() => sidePanelStore.setActiveTab(tab.id)}
              onDblClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                startRenamingTab(tab);
              }}
            >
              <Icon name={item.icon} size={15} strokeWidth={1.7} />
              <span class={styles.toolTabLabel}>{title()}</span>
            </button>
          )}
        >
          <input
            ref={(el) => { renameInput = el; }}
            class={styles.toolTabRenameInput}
            aria-label={`Rename ${title()} tab`}
            value={editingTitle()}
            onInput={(event) => setEditingTitle(event.currentTarget.value)}
            onMouseDown={blockDrag}
            onDblClick={(event) => event.stopPropagation()}
            onBlur={() => commitRenamingTab(tab)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                commitRenamingTab(tab);
              } else if (event.key === 'Escape') {
                event.preventDefault();
                cancelRenamingTab();
              }
            }}
          />
        </Show>
        <button
          type="button"
          class={styles.toolTabClose}
          aria-label={closeLabel}
          title={closeLabel}
          onMouseDown={blockDrag}
          onClick={(event) => {
            event.stopPropagation();
            if (editingTabId() === tab.id) {
              cancelRenamingTab();
            }
            sidePanelStore.closeTab(tab.id);
          }}
        >
          <Icon name="x" size={13} strokeWidth={2} />
        </button>
      </div>
    );
  };

  const toolsDockActive = () => sidePanelStore.isOpen();

  return (
    <div
      class={styles.toolDockToolbar}
      role="toolbar"
      aria-label="Tool dock toolbar"
      data-tauri-drag-region
      data-testid="tool-dock-toolbar"
      onMouseDown={(event) => void handleStartDragging(event)}
      onDblClick={(event) => void handleTitleBarDoubleClick(event)}
    >
      <Show when={toolsDockActive()}>
        <div class={styles.toolTabs}>
          <div class={styles.toolTabList} role="tablist" aria-label="Tool tabs">
            <For each={sidePanelStore.openTabs()}>
              {(tab) => renderToolTab(tab)}
            </For>
          </div>
          <div class={styles.addToolRoot} ref={(el) => { toolMenuRoot = el; }}>
            <button
              type="button"
              class={styles.addToolButton}
              onMouseDown={blockDrag}
              onClick={() => setToolMenuOpen((open) => !open)}
              aria-label="Add tool tab"
              aria-haspopup="menu"
              aria-expanded={toolMenuOpen()}
              title="Add tool tab"
            >
              <Icon name="plus" size={16} strokeWidth={1.7} />
            </button>
            <Show when={toolMenuOpen()}>
              <div class={styles.toolMenu} role="menu" aria-label="Add tool tab">
                <For each={TOOL_TAB_ITEMS}>
                  {(item) => {
                    const isOpen = () => item.view !== 'terminal'
                      && sidePanelStore.openTabs().some((tab) => tab.kind === item.view);
                    return (
                      <button
                        type="button"
                        role="menuitem"
                        class={styles.toolMenuItem}
                        onMouseDown={blockDrag}
                        onClick={() => activateToolTab(item)}
                      >
                        <span class={styles.toolMenuIcon}>
                          <Icon name={item.icon} size={16} strokeWidth={1.7} />
                        </span>
                        <span class={styles.toolMenuText}>
                          <span class={styles.toolMenuTitle}>{item.title}</span>
                          <span class={styles.toolMenuDescription}>{item.description}</span>
                        </span>
                        <Show when={isOpen()}>
                          <span class={styles.toolMenuState}>Open</span>
                        </Show>
                      </button>
                    );
                  }}
                </For>
              </div>
            </Show>
          </div>
        </div>
      </Show>
      <button
        type="button"
        class={styles.actionButton}
        classList={{ [styles.toolsDockToggleActive]: toolsDockActive() }}
        title={toolsDockActive() ? 'Hide tools dock' : 'Show tools dock'}
        aria-label={toolsDockActive() ? 'Hide tools dock' : 'Show tools dock'}
        onMouseDown={blockDrag}
        onClick={handleToggleToolsDock}
      >
        <Icon name="panel-right" size={15} strokeWidth={1.5} />
      </button>
    </div>
  );
};
