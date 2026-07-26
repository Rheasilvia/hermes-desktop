/**
 * Custom frameless-window title bar.
 *
 * The Electron window is frameless. This
 * bar provides the drag surface and — on Windows/Linux — the minimize /
 * maximize-restore / close buttons. On macOS the native traffic-light cluster
 * is preserved by Electron, while the renderer keeps the left action group
 * clear of it with a fixed offset. CSS app regions own dragging; browser
 * preview remains inert because no native host is present.
 */

import { Component, createSignal, onMount, onCleanup, Show, createMemo } from 'solid-js';
import { Icon } from '@/ui/atoms/Icon';
import { getNativeHost } from '@/services/native-host.js';
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
  actionToolbarLeft?: string;
  showEnvironmentToggle?: boolean;
  environmentPanelOpen?: boolean;
  onToggleEnvironmentPanel?: () => void;
}

export const TitleBar: Component<TitleBarProps> = (props) => {
  const nativeHost = getNativeHost();
  const [maximized, setMaximized] = createSignal(false);

  let unlistenState: (() => void) | null = null;
  let receivedStateEvent = false;
  let disposed = false;

  onMount(() => {
    if (!nativeHost) return;
    void nativeHost.window.state()
      .then((state) => {
        if (!disposed && !receivedStateEvent) setMaximized(state.maximized);
      })
      .catch(() => {
        /* best-effort — icon defaults to maximize */
      });
    try {
      unlistenState = nativeHost.window.onState((state) => {
        if (disposed) return;
        receivedStateEvent = true;
        setMaximized(state.maximized);
      });
    } catch {
      /* no state subscription; buttons still work */
    }
  });

  onCleanup(() => {
    disposed = true;
    try { unlistenState?.(); } catch { /* best-effort */ }
  });

  const handleMinimize = async () => {
    try { await nativeHost?.window.minimize(); } catch { /* ignore */ }
  };
  const handleToggleMaximize = async () => {
    try { await nativeHost?.window.toggleMaximize(); } catch { /* ignore */ }
  };
  const handleClose = async () => {
    try { await nativeHost?.window.close(); } catch { /* ignore */ }
  };

  const handleToggleToolsDock = () => {
    const shouldOpenToolMenu = !sidePanelStore.isOpen() && sidePanelStore.openTabs().length === 0;
    sidePanelStore.toggle();
    if (shouldOpenToolMenu) {
      sidePanelStore.requestToolMenuOpen();
    }
  };

  const sessionTitle = createMemo(() => sessionStore.activeSession?.title ?? null);
  const toolsDockActive = createMemo(() => sidePanelStore.isOpen());

  // macOS keeps native traffic lights; only Windows / Linux get the custom
  // window control cluster.
  const showControls = () => {
    const p = uiStore.platform;
    return p === 'windows' || p === 'linux';
  };

  return (
    <div
      class={styles.titleBar}
      aria-label="Hermes window titlebar"
    >
      {/* Visual overlay remains part of the CSS drag region. */}
      <div class={styles.dragSurface} />

      {/* Left group: nav buttons + session title. The group is anchored to the
          window, not the sidebar/layout flow, so sidebar toggles cannot move it
          under the macOS traffic-light cluster. CSS marks individual controls
          as no-drag; the session title remains part of the drag surface. */}
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
          onClick={props.onToggleSidebar}
        >
          <Icon name="panel-left" size={15} strokeWidth={1.5} />
        </button>
        <button
          type="button"
          class={styles.actionButton}
          title="Back"
          aria-label="Back"
          onClick={props.onNavigateBack}
        >
          <Icon name="chevron-left" size={16} strokeWidth={1.7} />
        </button>
        <button
          type="button"
          class={styles.actionButton}
          title="Forward"
          aria-label="Forward"
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

      {/* Right group: closed-dock entry point + optional window controls. */}
      <div class={styles.rightGroup} data-testid="titlebar-right-group">
        <Show when={props.showEnvironmentToggle}>
          <button
            type="button"
            class={styles.actionButton}
            classList={{ [styles.actionButtonActive]: Boolean(props.environmentPanelOpen) }}
            title={props.environmentPanelOpen ? 'Hide Environment panel' : 'Show Environment panel'}
            aria-label={props.environmentPanelOpen ? 'Hide Environment panel' : 'Show Environment panel'}
            aria-pressed={Boolean(props.environmentPanelOpen)}
            onClick={props.onToggleEnvironmentPanel}
          >
            <Icon name="monitor" size={15} strokeWidth={1.5} />
          </button>
        </Show>
        <Show when={!toolsDockActive()}>
          <button
            type="button"
            class={styles.actionButton}
            title="Show tools dock"
            aria-label="Show tools dock"
            onClick={handleToggleToolsDock}
          >
            <Icon name="panel-right" size={15} strokeWidth={1.5} />
          </button>
        </Show>

        <Show when={showControls()}>
          <div class={styles.controls}>
            <button
              type="button"
              class={styles.controlBtn}
              title="Minimize"
              aria-label="Minimize"
              onClick={() => void handleMinimize()}
            >
              <Icon name="minus" size={15} strokeWidth={1.5} />
            </button>
            <button
              type="button"
              class={styles.controlBtn}
              title={maximized() ? 'Restore' : 'Maximize'}
              aria-label={maximized() ? 'Restore' : 'Maximize'}
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
