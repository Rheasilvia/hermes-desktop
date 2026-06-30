import type { Component } from 'solid-js';
import { For, Match, Show, Switch, createEffect, createMemo, onCleanup, onMount } from 'solid-js';
import { sidePanelStore } from '@/stores/side-panel.js';
import { gitViewStore } from '@/stores/git-view.js';
import { previewStore, type PlanPreviewTarget, type NotebookPreviewTarget } from '@/stores/preview.js';
import { chatStore } from '@/stores/chat.js';
import type { PlanBlock } from '@/types/index.js';
import { WorkspaceTreeView } from '@/features/workspace/WorkspaceTreeView.js';
import { DiffPanel } from '@/features/diff/DiffPanel.js';
import { DelegationSidePanel } from '@/features/delegation/DelegationSidePanel.js';
import { NotebookPreview } from './NotebookPreview.js';
import { invoke } from '@tauri-apps/api/core';
import { Icon } from '@/ui/atoms/Icon.js';
import { MarkdownContent } from '@/ui/molecules/MarkdownContent.js';
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

function findPlanBlock(sessionId: string | null, target: PlanPreviewTarget): PlanBlock | null {
  if (!sessionId) return null;
  const live = chatStore.getLiveState(sessionId).activityBlocks
    .find((block): block is PlanBlock => block.type === 'plan' && block.id === target.blockId);
  if (live) return live;

  for (const message of chatStore.getMessages(sessionId)) {
    if (target.messageId && String(message.id) !== target.messageId) continue;
    const block = message.blocks
      .find((item): item is PlanBlock => item.type === 'plan' && item.id === target.blockId);
    if (block) return block;
  }

  return null;
}

const PlanPreview: Component<{ sessionId: string | null; target: PlanPreviewTarget }> = (props) => {
  const planBlock = createMemo(() => findPlanBlock(props.sessionId, props.target));
  return (
    <Show
      when={planBlock()}
      fallback={
        <div class={styles.emptyState} role="status" aria-label="Plan preview unavailable">
          <span class={styles.emptyIcon}>
            <Icon name="clipboard-list" size={24} />
          </span>
          <div class={styles.emptyTitle}>Plan unavailable</div>
          <div class={styles.emptyDescription}>This preview points to a plan that is no longer in the current transcript.</div>
        </div>
      }
    >
      {(block) => (
        <div class={styles.planPreview}>
          <MarkdownContent content={block().content} variant="document" />
        </div>
      )}
    </Show>
  );
};

const PreviewPlaceholder: Component<{ sessionId: string | null }> = (props) => {
  const record = createMemo(() => previewStore.get(props.sessionId));
  return (
    <div class={styles.pageChrome}>
      <Show
        when={record()}
        fallback={
          <div class={styles.emptyState} role="status" aria-label="No preview selected">
            <span class={styles.emptyIcon}>
              <Icon name="eye" size={24} />
            </span>
            <div class={styles.emptyTitle}>No preview selected</div>
            <div class={styles.emptyDescription}>Preview targets will open here in a future update.</div>
          </div>
        }
      >
        {(preview) => (
          <Switch>
            <Match when={preview().normalized.kind === 'notebook'}>
              <NotebookPreview
                sessionId={props.sessionId ?? ''}
                target={preview().normalized as NotebookPreviewTarget}
              />
            </Match>
            <Match when={preview().normalized.kind === 'plan'}>
              <PlanPreview
                sessionId={props.sessionId}
                target={preview().normalized as PlanPreviewTarget}
              />
            </Match>
            <Match when={preview().normalized.kind === 'file' || preview().normalized.kind === 'url'}>
              <div class={styles.previewPlaceholder} role="status" aria-label={`Preview ${preview().normalized.label}`}>
                <span class={styles.emptyIcon}>
                  <Icon name={preview().normalized.kind === 'url' ? 'globe' : 'file'} size={24} />
                </span>
                <div class={styles.emptyTitle}>{preview().normalized.label || 'Preview'}</div>
                <div class={styles.emptyDescription}>{preview().target}</div>
              </div>
            </Match>
          </Switch>
        )}
      </Show>
    </div>
  );
};

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
          <Match when={sidePanelStore.activeView() === 'preview'}>
            <div class={styles.page}>
              <PreviewPlaceholder sessionId={props.sessionId} />
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
