/**
 * Custom frameless-window title bar.
 *
 * The window is created with `decorations: false` (see tauri.conf.json). This
 * bar provides the drag surface and — on Windows/Linux — the minimize /
 * maximize-restore / close buttons. On macOS the native traffic-light cluster
 * is preserved by the Rust builder (`TitleBarStyle::Overlay` +
 * `traffic_light_position`), while the frontend keeps the left action group
 * clear of it with a fixed offset.
 *
 * All Tauri APIs are behind an `isTauri()` gate + dynamic import so the bar is
 * inert (drag/buttons no-op) in the browser/vite-preview environment — matching
 * the pattern in `services/notifications/native-notifications.ts`.
 */

import { Component, For, createSignal, onMount, onCleanup, Show, createMemo } from 'solid-js';
import { isTauri } from '@tauri-apps/api/core';
import { Icon, type IconName } from '@/ui/atoms/Icon';
import { uiStore } from '@/stores/ui';
import { sessionStore } from '@/stores/session';
import { sidePanelStore, type ToolTabView } from '@/stores/side-panel';
import styles from './TitleBar.module.css';

const TITLEBAR_ACTION_GROUP_LEFT = '85px';

interface TitleBarProps {
  onToggleSidebar: () => void;
  onNavigateBack: () => void;
  onNavigateForward: () => void;
  onNewSession: () => void;
  actionToolbarLeft?: string;
  toolsDockWidth?: number | null;
}

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

/** Lazily-resolved handle to the current Tauri window, or null off-Tauri. */
type WindowHandle = {
  minimize: () => Promise<void>;
  startDragging: () => Promise<void>;
  toggleMaximize: () => Promise<void>;
  close: () => Promise<void>;
  isMaximized: () => Promise<boolean>;
  onResized: (cb: () => void) => Promise<() => void>;
};

async function resolveWindow(): Promise<WindowHandle | null> {
  if (!isTauri()) return null;
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  return getCurrentWindow() as unknown as WindowHandle;
}

/** Stop mousedown propagation so a button click doesn't start a window drag. */
function blockDrag(event: MouseEvent) {
  event.stopPropagation();
}

function isInteractiveTitleBarTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement
    && target.closest('button, a, input, textarea, select, [role="button"]') != null;
}

export const TitleBar: Component<TitleBarProps> = (props) => {
  const [maximized, setMaximized] = createSignal(false);
  const [toolMenuOpen, setToolMenuOpen] = createSignal(false);

  let unlistenResized: (() => void) | null = null;
  let toolMenuRoot: HTMLDivElement | undefined;

  onMount(async () => {
    const win = await resolveWindow();
    if (!win) return;
    try {
      setMaximized(await win.isMaximized());
    } catch {
      /* best-effort — icon defaults to "maximize" */
    }
    try {
      unlistenResized = await win.onResized(async () => {
        try {
          setMaximized(await win.isMaximized());
        } catch {
          /* ignore — stale icon is harmless */
        }
      });
    } catch {
      /* no resize subscription; buttons still work */
    }
  });

  onCleanup(() => {
    try { unlistenResized?.(); } catch { /* best-effort */ }
  });

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

  const handleMinimize = async () => {
    const win = await resolveWindow();
    try { await win?.minimize(); } catch { /* ignore */ }
  };
  const handleStartDragging = async (event: MouseEvent) => {
    if (event.button !== 0) return;

    const win = await resolveWindow();
    try { await win?.startDragging(); } catch { /* ignore */ }
  };
  const handleToggleMaximize = async () => {
    const win = await resolveWindow();
    try { await win?.toggleMaximize(); } catch { /* ignore */ }
  };
  const handleTitleBarDoubleClick = async (event: MouseEvent) => {
    if (event.button !== 0) return;
    if (isInteractiveTitleBarTarget(event.target)) return;
    event.preventDefault();

    await handleToggleMaximize();
  };
  const handleClose = async () => {
    const win = await resolveWindow();
    try { await win?.close(); } catch { /* ignore */ }
  };

  const handleToggleToolsDock = () => {
    sidePanelStore.toggle();
  };

  const sessionTitle = createMemo(() => sessionStore.activeSession?.title ?? null);
  const toolsDockActive = createMemo(() => sidePanelStore.isOpen());
  const rightGroupStyle = createMemo(() => (
    props.toolsDockWidth != null ? { width: `${props.toolsDockWidth}px` } : undefined
  ));

  const activateToolTab = (item: ToolTabItem) => {
    sidePanelStore.openTab(item.view);
    setToolMenuOpen(false);
  };

  const renderToolTab = (view: ToolTabView) => {
    const item = toolTabItemForView(view);
    const selected = () => sidePanelStore.activeView() === view;
    return (
      <button
        type="button"
        role="tab"
        class={styles.toolTab}
        classList={{ [styles.toolTabActive]: selected() }}
        aria-selected={selected()}
        title={item.title}
        onMouseDown={blockDrag}
        onClick={() => sidePanelStore.setActiveView(view)}
      >
        <Icon name={item.icon} size={15} strokeWidth={1.7} />
        <span class={styles.toolTabLabel}>{item.title}</span>
      </button>
    );
  };

  // macOS keeps native traffic lights; only Windows / Linux get the custom
  // window control cluster.
  const showControls = () => {
    const p = uiStore.platform;
    return p === 'windows' || p === 'linux';
  };

  return (
    <div
      class={styles.titleBar}
      data-tauri-drag-region
      aria-label="Hermes window titlebar"
      onMouseDown={(event) => void handleStartDragging(event)}
      onDblClick={(event) => void handleTitleBarDoubleClick(event)}
    >
      {/* Semi-transparent overlay behind interactive children that also serves
          as a fallback drag target for the visual-only Tauri drag-region
          attribute. Actual drag handling is on the parent so events bubble up
          from non-interactive regions (e.g. the session title text). */}
      <div class={styles.dragSurface} />

      {/* Left group: nav buttons + session title. The group is anchored to the
          window, not the sidebar/layout flow, so sidebar toggles cannot move it
          under the macOS traffic-light cluster. Individual buttons block drag;
          the session title intentionally does not so users can drag the window
          by grabbing the title text. */}
      <div
        class={styles.actionToolbar}
        role="toolbar"
        aria-label="Window navigation"
        style={{ left: props.actionToolbarLeft ?? TITLEBAR_ACTION_GROUP_LEFT }}
      >
        <button
          type="button"
          class={styles.actionButton}
          title="Toggle Sidebar"
          aria-label="Toggle Sidebar"
          onMouseDown={blockDrag}
          onClick={props.onToggleSidebar}
        >
          <Icon name="panel-left" size={15} strokeWidth={1.5} />
        </button>
        <button
          type="button"
          class={styles.actionButton}
          title="Back"
          aria-label="Back"
          onMouseDown={blockDrag}
          onClick={props.onNavigateBack}
        >
          <Icon name="chevron-left" size={16} strokeWidth={1.7} />
        </button>
        <button
          type="button"
          class={styles.actionButton}
          title="Forward"
          aria-label="Forward"
          onMouseDown={blockDrag}
          onClick={props.onNavigateForward}
        >
          <Icon name="chevron-right" size={16} strokeWidth={1.7} />
        </button>

        <Show when={uiStore.sidebarCollapsed}>
          <button
            type="button"
            class={styles.actionButton}
            title="New Chat"
            aria-label="New Chat"
            onMouseDown={blockDrag}
            onClick={props.onNewSession}
          >
            <Icon name="plus" size={16} strokeWidth={1.7} />
          </button>
        </Show>

        <Show when={sessionTitle()}>
          <span class={styles.sessionTitle} title={sessionTitle()!}>
            {sessionTitle()!}
          </span>
        </Show>
      </div>

      <div class={styles.spacer} />

      {/* Right group: tools dock toggle + optional window controls. */}
      <div class={styles.rightGroup} style={rightGroupStyle()} data-testid="titlebar-right-group">
        <Show when={toolsDockActive()}>
          <div class={styles.toolTabs}>
            <div class={styles.toolTabList} role="tablist" aria-label="Tool tabs">
              <For each={sidePanelStore.openTabs()}>
                {(view) => renderToolTab(view)}
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
                      const isOpen = () => sidePanelStore.openTabs().includes(item.view);
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

        <Show when={showControls()}>
          <div class={styles.controls}>
            <button
              type="button"
              class={styles.controlBtn}
              title="Minimize"
              aria-label="Minimize"
              onMouseDown={blockDrag}
              onClick={() => void handleMinimize()}
            >
              <Icon name="minus" size={15} strokeWidth={1.5} />
            </button>
            <button
              type="button"
              class={styles.controlBtn}
              title={maximized() ? 'Restore' : 'Maximize'}
              aria-label={maximized() ? 'Restore' : 'Maximize'}
              onMouseDown={blockDrag}
              onClick={() => void handleToggleMaximize()}
            >
              <Show when={maximized()} fallback={<Icon name="maximize" size={13} strokeWidth={1.5} />}>
                <Icon name="square" size={12} strokeWidth={1.5} />
              </Show>
            </button>
            <button
              type="button"
              class={`${styles.controlBtn} ${styles.closeBtn}`}
              title="Close"
              aria-label="Close"
              onMouseDown={blockDrag}
              onClick={() => void handleClose()}
            >
              <Icon name="x" size={15} strokeWidth={1.5} />
            </button>
          </div>
        </Show>
      </div>
    </div>
  );
};
