import type { Component } from 'solid-js';
import { Match, Switch } from 'solid-js';
import { sidePanelStore, type SidePanelTab } from '@/stores/side-panel.js';
import { gitViewStore } from '@/stores/git-view.js';
import { WorkspaceTreeView } from '@/features/workspace/WorkspaceTreeView.js';
import { DiffPanel } from '@/features/diff/DiffPanel.js';
import { DelegationSidePanel } from '@/features/delegation/DelegationSidePanel.js';
import { Icon } from '@/ui/atoms/Icon.js';
import styles from './WorkspaceSidePanel.module.css';

interface WorkspaceSidePanelProps {
  sessionId: string | null;
  workspacePath: string | null;
  panelWidth: number;
  ref?: (el: HTMLDivElement) => void;
}

function tabButton(tab: SidePanelTab, label: string, icon: 'folder-open' | 'git-branch' | 'users') {
  const selected = () => sidePanelStore.activeTab() === tab;
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected()}
      class={styles.tab}
      classList={{ [styles.tabActive]: selected() }}
      onClick={() => {
        sidePanelStore.setActiveTab(tab);
        if (tab === 'git') void gitViewStore.fetchDiff();
      }}
    >
      <Icon name={icon} size={14} />
      <span>{label}</span>
    </button>
  );
}

export const WorkspaceSidePanel: Component<WorkspaceSidePanelProps> = (props) => {
  return (
    <aside
      ref={(el) => props.ref?.(el as HTMLDivElement)}
      class={styles.panel}
      style={{ width: `${props.panelWidth}px` }}
      aria-label="Workspace side panel"
    >
      <div class={styles.header}>
        <div class={styles.tabs} role="tablist" aria-label="Workspace panel views">
          {tabButton('workspace', 'Workspace', 'folder-open')}
          {tabButton('git', 'Git', 'git-branch')}
          {tabButton('delegation', 'Delegation', 'users')}
        </div>
        <div class={styles.spacer} />
        <button
          type="button"
          class={styles.closeButton}
          onClick={() => sidePanelStore.close()}
          aria-label="Close workspace panel"
        >
          <Icon name="x" size={16} />
        </button>
      </div>
      <div class={styles.body}>
        <Switch>
          <Match when={sidePanelStore.activeTab() === 'workspace'}>
            <WorkspaceTreeView sessionId={props.sessionId} workspacePath={props.workspacePath} />
          </Match>
          <Match when={sidePanelStore.activeTab() === 'git'}>
            <DiffPanel
              visible={true}
              data={gitViewStore.diffData()}
              loading={gitViewStore.diffLoading()}
              error={gitViewStore.diffError()}
              hasWorkspace={props.workspacePath != null}
              activeFileIndex={gitViewStore.activeFileIndex()}
              onSelectFile={gitViewStore.selectDiffFile}
            />
          </Match>
          <Match when={sidePanelStore.activeTab() === 'delegation'}>
            <DelegationSidePanel />
          </Match>
        </Switch>
      </div>
    </aside>
  );
};
