import type { Component } from 'solid-js';
import { For, Match, Switch, createEffect, createMemo, onCleanup, onMount } from 'solid-js';
import { sidePanelStore } from '@/stores/side-panel.js';
import { gitViewStore } from '@/stores/git-view.js';
import { WorkspaceTreeView } from '@/features/workspace/WorkspaceTreeView.js';
import { DiffPanel } from '@/features/diff/DiffPanel.js';
import { DelegationSidePanel } from '@/features/delegation/DelegationSidePanel.js';
import { invoke } from '@tauri-apps/api/core';
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
  onInsertComposerText?: (text: string) => void;
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
      void gitViewStore.fetchReview();
    }
  });

  onMount(() => {
    const refreshReviewOnFocus = () => {
      if (sidePanelStore.activeView() === 'review') {
        void gitViewStore.fetchReview();
      }
    };
    window.addEventListener('focus', refreshReviewOnFocus);
    onCleanup(() => window.removeEventListener('focus', refreshReviewOnFocus));
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
                error={gitViewStore.reviewError() ?? gitViewStore.diffError()}
                hasWorkspace={props.workspacePath != null}
                activeFileIndex={gitViewStore.activeFileIndex()}
                reviewData={gitViewStore.reviewData()}
                selectedReviewPath={gitViewStore.selectedReviewPath()}
                actionBusyKey={gitViewStore.actionBusyKey()}
                actionInFlight={gitViewStore.reviewActionInFlight()}
                actionLog={gitViewStore.actionLog}
                onClearActionLog={gitViewStore.clearActionLog}
                prDisabled={gitViewStore.isOnDefaultBranch()}
                prDisabledReason={gitViewStore.isOnDefaultBranch()
                  ? `You're on the default branch "${gitViewStore.currentBranch()}". Switch to a feature branch to create a PR.`
                  : null}
                createdPrUrl={gitViewStore.createdPrUrl()}
                shipInfo={gitViewStore.reviewShipInfo()}
                onOpenPrUrl={(url) => void invoke('open_external', { url })}
                commitMessage={gitViewStore.commitMessage()}
                commitMessageLoading={gitViewStore.commitMessageLoading()}
                commitMessageError={gitViewStore.commitMessageErrorLabel()}
                reviewFileRailWidth={gitViewStore.reviewFileRailWidth()}
                onReviewFileRailWidthChange={gitViewStore.setReviewFileRailWidth}
                onResetReviewFileRailWidth={gitViewStore.resetReviewFileRailWidth}
                onSelectFile={gitViewStore.selectDiffFile}
                onSelectReviewFile={(path) => void gitViewStore.selectReviewFile(path)}
                onStageFile={(path) => void gitViewStore.stagePath(path)}
                onUnstageFile={(path) => void gitViewStore.unstagePath(path)}
                onRevertFile={(path) => void gitViewStore.revertPath(path)}
                onRefresh={() => void gitViewStore.fetchReview()}
                onStageAll={() => void gitViewStore.stageAllReviewChanges()}
                onRevertAll={() => void gitViewStore.revertAllReviewChanges()}
                onCommitMessageChange={gitViewStore.setCommitMessage}
                onGenerateCommitMessage={() => void gitViewStore.generateCommitMessage(gitViewStore.commitMessage())}
                onCancelGenerateCommitMessage={gitViewStore.cancelCommitMessageGeneration}
                onCommit={(message) => void gitViewStore.commitReview(message)}
                onCommitPush={(message) => void gitViewStore.commitThenMaybePush({ message, push: true })}
                onPush={() => void gitViewStore.pushReview()}
                onCreatePr={() => void gitViewStore.createPullRequest()}
                onCommitPushCreatePr={(message) => void gitViewStore.commitPushAndCreatePullRequest(message)}
                onAskHermes={() => gitViewStore.submitReviewPromptToComposer()}
                showInstallAction={gitViewStore.hasInstallableReviewError()}
                installActionBusy={gitViewStore.installingTools()}
                onInstallAction={() => void gitViewStore.installCommandLineTools()}
                retryActionBusy={gitViewStore.retryingReview()}
                onRetryAction={() => void gitViewStore.retryReview()}
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
                  sessionId={props.sessionId}
                  onSendToChat={props.onInsertComposerText}
                />
              </div>
            );
          }}
        </For>
      </div>
    </aside>
  );
};
