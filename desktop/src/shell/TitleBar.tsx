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

import { Component, createSignal, onMount, onCleanup, Show, createMemo } from 'solid-js';
import { isTauri } from '@tauri-apps/api/core';
import { Icon } from '@/ui/atoms/Icon';
import { uiStore } from '@/stores/ui';
import { sessionStore } from '@/stores/session';
import { sidePanelStore } from '@/stores/side-panel';
import styles from './TitleBar.module.css';

const TITLEBAR_ACTION_GROUP_LEFT = '85px';

interface TitleBarProps {
  onToggleSidebar: () => void;
  onNavigateBack: () => void;
  onNavigateForward: () => void;
  onNewSession: () => void;
}

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

export const TitleBar: Component<TitleBarProps> = (props) => {
  const [maximized, setMaximized] = createSignal(false);

  let unlistenResized: (() => void) | null = null;

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
  const handleClose = async () => {
    const win = await resolveWindow();
    try { await win?.close(); } catch { /* ignore */ }
  };

  const handleToggleWorkspace = () => {
    sidePanelStore.toggle('workspace');
  };

  const sessionTitle = createMemo(() => sessionStore.activeSession?.title ?? null);
  const workspacePanelActive = createMemo(() => sidePanelStore.isOpen());

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
        style={{ left: TITLEBAR_ACTION_GROUP_LEFT }}
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

      {/* Right group: workspace panel toggle + optional window controls. */}
      <div class={styles.rightGroup}>
        <button
          type="button"
          class={styles.actionButton}
          classList={{ [styles.workspaceToggleActive]: workspacePanelActive() }}
          title={workspacePanelActive() ? 'Hide workspace panel' : 'Show workspace panel'}
          aria-label={workspacePanelActive() ? 'Hide workspace panel' : 'Show workspace panel'}
          onMouseDown={blockDrag}
          onClick={handleToggleWorkspace}
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
