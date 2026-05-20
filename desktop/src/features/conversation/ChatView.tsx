import type { Component } from 'solid-js';
import { Show, For, createEffect, onMount, onCleanup, createMemo, createSignal, Switch, Match, untrack } from 'solid-js';
import type {
  MessageDeltaPayload,
  MessageCompletePayload,
  ToolStartPayload,
  ToolProgressPayload,
  ToolCompletePayload,
  ToolGeneratingPayload,
  ToolErrorPayload,
  ReasoningDeltaPayload,
  ApprovalRequestPayload,
  ClarifyRequestPayload,
} from '@/types/gateway.js';
import type { RenderedMessage } from '@/types/index.js';
import { chatStore } from '@/stores/chat.js';
import { diffStore } from '@/stores/chat.js';
import { sessionStore } from '@/stores/session.js';
import { getGateway } from '@/stores/context.js';
import { MessageBubble } from './MessageBubble.js';
import { MessageInput } from './MessageInput.js';
import { ModelSelector } from './ModelSelector.js';
import { ChatToolbar } from './ChatToolbar.js';
import { DiffPanel } from '@/features/diff/DiffPanel.js';
import { EmptyChatState } from './EmptyChatState.js';
import { ErrorBanner } from './ErrorBanner.js';
import { WorkspaceBanner } from './WorkspaceBanner.js';
import { Icon } from '@/ui/atoms/Icon.js';
import { ToolCallPanel } from './ToolCallPanel.js';
import { ApprovalCard } from './ApprovalCard.js';
import { ClarificationCard } from './ClarificationCard.js';
import { MemoryContextCard } from './MemoryContextCard.js';
import { liveToRow } from './toolCallMappers.js';
import styles from './ChatView.module.css';

interface ChatViewProps {
  sessionId?: string;
}

export const ChatView: Component<ChatViewProps> = (props) => {
  const sessionId = () => props.sessionId ?? '';
  let messagesEndRef: HTMLDivElement | undefined;
  let chatBodyRef: HTMLDivElement | undefined;
  let diffPanelEl: HTMLDivElement | undefined;
  let dragHandleEl: HTMLDivElement | undefined;
  const [dragging, setDragging] = createSignal(false);

  const workspacePath = () => sessionStore.activeSession?.workspace_path ?? null;

  const messages = (): RenderedMessage[] => chatStore.getMessages(sessionId());
  const liveState = () => chatStore.getLiveState(sessionId());
  const isStreaming = (): boolean => chatStore.isStreaming(sessionId());
  const error = (): string | null => chatStore.getError(sessionId());

  const isEmpty = createMemo(() => messages().length === 0);
  const isLoading = () => chatStore.isLoadingMessages(sessionId());

  function computeDateSeparators(msgs: RenderedMessage[]): Map<number, string> {
    const separators = new Map<number, string>();
    let lastDay: string | null = null;
    for (let i = 0; i < msgs.length; i++) {
      const ts = msgs[i].timestamp;
      if (ts == null) continue;
      const day = new Date(ts * 1000).toDateString();
      if (day !== lastDay) {
        separators.set(i, formatDateLabel(ts));
        lastDay = day;
      }
    }
    return separators;
  }

  function formatDateLabel(ts: number): string {
    const date = new Date(ts * 1000);
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    if (date.toDateString() === today.toDateString()) return 'Today';
    if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
    return date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
  }

  const dateSeparators = createMemo(() => computeDateSeparators(messages()));

  createEffect(() => {
    const msgs = messages();
    if (msgs.length > 0) {
      scrollToBottom();
    }
  });

  createEffect(() => {
    const hasCard = !!(liveState().pendingApproval || liveState().pendingClarify);
    if (hasCard) {
      scrollToBottom();
    }
  });

  createEffect(() => {
    const path = workspacePath();
    diffStore.setWorkspacePath(path);
  });

  const scrollToBottom = () => {
    requestAnimationFrame(() => {
      messagesEndRef?.scrollIntoView({ behavior: 'smooth' });
    });
  };

  const handleSend = async (text: string, _attachments?: any[]) => {
    chatStore.appendUserMessage(sessionId(), text);
    await chatStore.sendMessage(sessionId(), text);
  };

  const onMessageDelta = (payload: MessageDeltaPayload) => {
    chatStore.handleDelta(sessionId(), payload);
  };

  const onMessageComplete = (payload: MessageCompletePayload) => {
    chatStore.handleMessageComplete(sessionId(), payload);
  };

  const onReasoningDelta = (payload: ReasoningDeltaPayload) => {
    chatStore.handleReasoningDelta(sessionId(), payload.text);
  };

  const onToolStart = (payload: ToolStartPayload) => {
    chatStore.handleToolStart(sessionId(), payload);
  };

  const onToolProgress = (payload: ToolProgressPayload) => {
    chatStore.handleToolProgress(sessionId(), payload);
  };

  const onToolComplete = (payload: ToolCompletePayload) => {
    chatStore.handleToolComplete(sessionId(), payload);
  };

  const onToolGenerating = (payload: ToolGeneratingPayload) => {
    chatStore.handleToolGenerating(sessionId(), payload);
  };

  const onToolError = (payload: ToolErrorPayload) => {
    chatStore.handleToolError(sessionId(), payload);
  };

  const onApprovalRequest = (payload: ApprovalRequestPayload) => {
    chatStore.handleApprovalRequest(sessionId(), payload);
  };

  const onClarifyRequest = (payload: ClarifyRequestPayload) => {
    chatStore.handleClarifyRequest(sessionId(), payload);
  };

  const handleDragStart = (e: MouseEvent) => {
    e.preventDefault();
    setDragging(true);

    if (diffPanelEl) {
      diffPanelEl.style.transition = 'none';
      diffPanelEl.style.willChange = 'width';
    }
    if (dragHandleEl) dragHandleEl.classList.add(styles.dragHandleActive);
    if (chatBodyRef) chatBodyRef.classList.add(styles.chatBodyDragging);

    const startX = e.clientX;
    const startWidth = diffPanelEl?.offsetWidth ?? 500;
    const containerWidth = chatBodyRef?.clientWidth ?? 1200;
    let lastWidth = startWidth;
    let prevWidth = startWidth;
    let dirty = false;
    let rafId: number | undefined;

    const onMove = (ev: MouseEvent) => {
      const delta = startX - ev.clientX;
      lastWidth = Math.min(Math.max(startWidth + delta, 320), containerWidth * 0.8);
      if (lastWidth !== prevWidth) {
        dirty = true;
        prevWidth = lastWidth;
      }
    };

    const tick = () => {
      if (dirty && diffPanelEl) {
        diffPanelEl.style.width = `${lastWidth}px`;
        dirty = false;
      }
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);

    const onUp = () => {
      if (rafId != null) cancelAnimationFrame(rafId);
      setDragging(false);

      if (diffPanelEl) {
        diffPanelEl.style.transition = '';
        diffPanelEl.style.willChange = '';
      }
      if (dragHandleEl) dragHandleEl.classList.remove(styles.dragHandleActive);
      if (chatBodyRef) chatBodyRef.classList.remove(styles.chatBodyDragging);

      diffStore.setPanelWidth(lastWidth);
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  createEffect(() => {
    const sid = sessionId();
    if (!sid) return;
    sessionStore.setActiveSession(sid);
    untrack(() => { void chatStore.loadMessages(sid); });
  });

  onMount(() => {
    const gateway = getGateway();
    if (!gateway) return;

    gateway.on('message.delta', onMessageDelta);
    gateway.on('message.complete', onMessageComplete);
    gateway.on('reasoning.delta', onReasoningDelta);
    gateway.on('tool.start', onToolStart);
    gateway.on('tool.progress', onToolProgress);
    gateway.on('tool.complete', onToolComplete);
    gateway.on('tool.generating', onToolGenerating);
    gateway.on('tool.error', onToolError);
    gateway.on('approval.request', onApprovalRequest);
    gateway.on('clarify.request', onClarifyRequest);
  });

  onCleanup(() => {
    const gateway = getGateway();
    if (!gateway) return;

    gateway.off('message.delta', onMessageDelta);
    gateway.off('message.complete', onMessageComplete);
    gateway.off('reasoning.delta', onReasoningDelta);
    gateway.off('tool.start', onToolStart);
    gateway.off('tool.progress', onToolProgress);
    gateway.off('tool.complete', onToolComplete);
    gateway.off('tool.generating', onToolGenerating);
    gateway.off('tool.error', onToolError);
    gateway.off('approval.request', onApprovalRequest);
    gateway.off('clarify.request', onClarifyRequest);
  });

  return (
    <div class={styles.chatView}>
      <ChatToolbar
        workspacePath={workspacePath()}
        sessionTitle={sessionStore.activeSession?.title}
        splitScreenActive={diffStore.isDiffOpen()}
        onToggleSplitScreen={() => diffStore.toggleDiff()}
      />

      <Show when={error()}>
        <ErrorBanner
          message={error()!}
          onRetry={() => handleSend('')}
          onDismiss={() => { chatStore.clearError(sessionId()); }}
        />
      </Show>

      <WorkspaceBanner workspacePath={workspacePath()} />

      <Show when={liveState().memoryContext}>
        <MemoryContextCard
          items={liveState().memoryContext!}
          onEdit={() => {}}
        />
      </Show>

      <div class={styles.chatBody} ref={chatBodyRef}>
        <div class={styles.chatPane}>
          <Switch>
            <Match when={isLoading()}>
              <div class={styles.loadingState}>
                <div class={styles.loadingRow}>
                  <Icon name="loader" size={20} class={styles.loadingIcon} />
                  <span class={styles.loadingLabel}>Loading messages...</span>
                </div>
              </div>
            </Match>
            <Match when={isEmpty()}>
              <EmptyChatState onSuggestionClick={(idx) => {
                const suggestions = ['Debug my code', 'Review my PR', 'Plan a feature'];
                handleSend(suggestions[idx] ?? '');
              }} />
            </Match>
            <Match when={true}>
              <div
                class={styles.messageList}
                style={{
                  "padding-bottom": (liveState().pendingApproval || liveState().pendingClarify) ? '60px' : undefined,
                }}
              >
                <For each={messages()}>
                  {(message, getIndex) => {
                    const idx = getIndex();
                    return (
                      <MessageBubble
                        message={message}
                        showDateSeparator={dateSeparators().has(idx)}
                        dateSeparatorLabel={dateSeparators().get(idx)}
                      />
                    );
                  }}
                </For>
                <Show when={liveState().activeTools.length > 0}>
                  <ToolCallPanel
                    rows={liveState().activeTools.map(liveToRow)}
                    isLive={true}
                  />
                </Show>
                <div ref={messagesEndRef} />
              </div>
            </Match>
          </Switch>

          <div class={styles.inputArea}>
            <Show when={liveState().pendingApproval || liveState().pendingClarify}>
              <div class={styles.cardDock}>
                <Show when={liveState().pendingApproval}>
                  <ApprovalCard
                    command={liveState().pendingApproval!.command}
                    description={liveState().pendingApproval!.description}
                    onAllow={() => void chatStore.respondApproval(sessionId(), true)}
                    onDeny={() => void chatStore.respondApproval(sessionId(), false)}
                  />
                </Show>
                <Show when={liveState().pendingClarify}>
                  <ClarificationCard
                    question={liveState().pendingClarify!.question}
                    choices={liveState().pendingClarify!.choices}
                    onRespond={(text) => void chatStore.respondClarify(sessionId(), liveState().pendingClarify!.requestId, text)}
                  />
                </Show>
              </div>
            </Show>

            <MessageInput
              onSend={handleSend}
              onStop={() => chatStore.cancelMessage(sessionId())}
              disabled={isStreaming()}
              isStreaming={isStreaming()}
              modelSlot={(dimmed) => <ModelSelector dimmed={dimmed} />}
              workspacePath={workspacePath()}
              isNewConversation={isEmpty()}
              onWorkspaceChange={(path) => {
                const sid = sessionId();
                if (sid) sessionStore.updateWorkspace(sid, path);
              }}
            />
          </div>
        </div>

        <Show when={diffStore.isDiffOpen()}>
          <div class={styles.diffSeparator} />
          <div
            ref={(el) => { dragHandleEl = el; }}
            class={styles.dragHandle}
            onMouseDown={handleDragStart}
          />
        </Show>
        <DiffPanel
          ref={(el: HTMLDivElement) => { diffPanelEl = el; }}
          visible={diffStore.isDiffOpen()}
          data={diffStore.diffData()}
          loading={diffStore.diffLoading()}
          error={diffStore.diffError()}
          panelWidth={diffStore.panelWidth()}
          hasWorkspace={workspacePath() != null}
          onClose={() => diffStore.closeDiff()}
          onAddWorkspace={() => {}}
        />
      </div>
    </div>
  );
};
