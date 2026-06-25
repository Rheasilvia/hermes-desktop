import type { Component } from 'solid-js';
import { For, Match, Switch, createEffect, createMemo } from 'solid-js';
import { sidePanelStore } from '@/stores/side-panel.js';
import { gitViewStore } from '@/stores/git-view.js';
import { WorkspaceTreeView } from '@/features/workspace/WorkspaceTreeView.js';
import { DiffPanel } from '@/features/diff/DiffPanel.js';
import { DelegationSidePanel } from '@/features/delegation/DelegationSidePanel.js';
import { Icon } from '@/ui/atoms/Icon.js';
import { TerminalPanel } from './TerminalPanel.js';
import styles from './RightToolPanel.module.css';

interface RightToolPanelProps {
  sessionId: string | null;
  workspacePath: string | null;
  overlay?: boolean;
  contentWidth?: number | null;
  resizeMode?: 'live' | 'deferred';
  resizing?: boolean;
  visible?: boolean;
}

export const RightToolPanel: Component<RightToolPanelProps> = (props) => {
  const bodyFrozen = () => Boolean(
    props.resizing
    && props.resizeMode === 'deferred'
    && props.contentWidth != null,
  );
  const bodyStyle = () => {
    if (!bodyFrozen() || props.contentWidth == null) return undefined;
    return { width: `${props.contentWidth}px` };
  };

  const terminalTabs = createMemo(() =>
    sidePanelStore.openTabs().filter((tab) => tab.kind === 'terminal'),
  );

  createEffect(() => {
    if (sidePanelStore.activeView() === 'review') {
      void gitViewStore.fetchDiff();
    }
  });

  return (
    <aside
      class={styles.panel}
      classList={{ [styles.panelOverlay]: props.overlay }}
      aria-label="Right tools dock"
    >
      <div
        class={styles.body}
        classList={{ [styles.bodyFrozen]: bodyFrozen() }}
        style={bodyStyle()}
      >
        <Switch>
          <Match when={sidePanelStore.activeView() === 'menu'}>
            <div class={styles.emptyState} role="status" aria-label="No tool tab selected">
              <span class={styles.emptyIcon}>
                <Icon name="panel-right" size={24} />
              </span>
              <div class={styles.emptyTitle}>Select a tool</div>
              <div class={styles.emptyDescription}>Use the plus button in the toolbar to add Review, Terminal, Open file, or Delegation.</div>
            </div>
          </Match>
          <Match when={sidePanelStore.activeView() === 'review'}>
            <div class={styles.page}>
              <DiffPanel
                visible={true}
                data={gitViewStore.diffData()}
                loading={gitViewStore.diffLoading()}
                error={gitViewStore.diffError()}
                hasWorkspace={props.workspacePath != null}
                activeFileIndex={gitViewStore.activeFileIndex()}
                onSelectFile={gitViewStore.selectDiffFile}
              />
            </div>
          </Match>
          <Match when={sidePanelStore.activeView() === 'files'}>
            <div class={styles.page}>
              <WorkspaceTreeView sessionId={props.sessionId} workspacePath={props.workspacePath} />
            </div>
          </Match>
          <Match when={sidePanelStore.activeView() === 'delegation'}>
            <div class={styles.page}>
              <DelegationSidePanel sessionId={props.sessionId} />
            </div>
          </Match>
        </Switch>
        <For each={terminalTabs()}>
          {(tab) => {
            const active = () => sidePanelStore.activeTabId() === tab.id;
            return (
              <div
                class={`${styles.page} ${active() ? '' : styles.hiddenPage}`}
                aria-hidden={!active()}
              >
                <TerminalPanel
                  active={props.visible !== false && active()}
                  cwd={tab.cwd}
                />
              </div>
            );
          }}
        </For>
      </div>
    </aside>
  );
};
