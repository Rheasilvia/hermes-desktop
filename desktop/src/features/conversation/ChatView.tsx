import type { Component } from 'solid-js';
import { Show, For, createEffect, onMount, onCleanup, createMemo, createSignal, Switch, Match, untrack } from 'solid-js';
import { useNavigate } from '@solidjs/router';
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
import type { MessageActionType } from '@/types/ui/message.js';
import { chatStore } from '@/stores/chat.js';
import { diffStore } from '@/stores/chat.js';
import { sessionStore } from '@/stores/session.js';
import { modelStore } from '@/stores/models.js';
import { getGateway } from '@/stores/context.js';
import { ROUTES } from '@/routes';
import { MessageBubble } from './MessageBubble.js';
import { AssistantMessage } from './AssistantMessage.js';
import type { MessageBlock } from '@/types/index.js';
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
import { JumpToBottom } from './JumpToBottom.js';
import { liveToRow } from './toolCallMappers.js';
import styles from './ChatView.module.css';

interface ChatViewProps {
  sessionId?: string;
}

const NEAR_BOTTOM_THRESHOLD = 100;
const SCROLL_PAUSE_THRESHOLD = 80;

export const ChatView: Component<ChatViewProps> = (props) => {
  const navigate = useNavigate();
  const sessionId = () => props.sessionId ?? '';
  let messagesEndRef: HTMLDivElement | undefined;
  let chatBodyRef: HTMLDivElement | undefined;
  let messageListRef: HTMLDivElement | undefined;
  let diffPanelEl: HTMLDivElement | undefined;
  let dragHandleEl: HTMLDivElement | undefined;
  const [dragging, setDragging] = createSignal(false);
  const [editDraft, setEditDraft] = createSignal<string | null>(null);
  const [isNearBottom, setIsNearBottom] = createSignal(true);
  const [userScrolledUp, setUserScrolledUp] = createSignal(false);
  const [unreadCount, setUnreadCount] = createSignal(0);
  const [lastMessageCount, setLastMessageCount] = createSignal(0);

  const workspacePath = () => sessionStore.activeSession?.workspace_path ?? null;

  const messages = (): RenderedMessage[] => chatStore.getMessages(sessionId());
  const liveState = () => chatStore.getLiveState(sessionId());
  const isStreaming = (): boolean => chatStore.isStreaming(sessionId());
  const error = (): string | null => chatStore.getError(sessionId());

  const isEmpty = createMemo(() => messages().length === 0);
  const isLoading = () => chatStore.isLoadingMessages(sessionId());

  const liveBlocks = createMemo((): MessageBlock[] => {
    const live = liveState();
    const blocks: MessageBlock[] = [];
    if (live.reasoningText) {
      blocks.push({
        type: 'reasoning',
        id: 'live-reasoning',
        content: live.reasoningText,
        isStreaming: true,
        tokenCount: null,
      });
    }
    if (live.streamingText) {
      blocks.push({
        type: 'text',
        id: 'live-text',
        content: live.streamingText,
      });
    }
    return blocks;
  });

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

  const scrollToBottom = (opts?: { force?: boolean; behavior?: ScrollBehavior }) => {
    if (!opts?.force && userScrolledUp()) return;
    requestAnimationFrame(() => {
      messagesEndRef?.scrollIntoView({ behavior: opts?.behavior ?? 'smooth' });
    });
  };

  const handleScroll = () => {
    const el = messageListRef;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const near = distanceFromBottom < NEAR_BOTTOM_THRESHOLD;
    setIsNearBottom(near);
    if (near) {
      setUserScrolledUp(false);
      setUnreadCount(0);
    } else if (distanceFromBottom > SCROLL_PAUSE_THRESHOLD) {
      setUserScrolledUp(true);
    }
  };

  createEffect(() => {
    const msgs = messages();
    const prevCount = lastMessageCount();
    if (msgs.length > prevCount) {
      if (userScrolledUp()) {
        setUnreadCount((c) => c + (msgs.length - prevCount));
      } else {
        scrollToBottom();
      }
      setLastMessageCount(msgs.length);
    } else if (msgs.length > 0 && prevCount === 0) {
      setLastMessageCount(msgs.length);
      scrollToBottom();
    }
  });

  createEffect(() => {
    const live = liveBlocks();
    if (live.length > 0) {
      if (userScrolledUp()) {
        setUnreadCount((c) => c + 1);
      } else {
        scrollToBottom();
      }
    }
  });

  createEffect(() => {
    const hasCard = !!(liveState().pendingApproval || liveState().pendingClarify);
    if (hasCard) {
      scrollToBottom({ force: true });
    }
  });

  createEffect(() => {
    const path = workspacePath();
    diffStore.setWorkspacePath(path);
  });

  const handleSend = async (text: string, _attachments?: any[]) => {
    chatStore.appendUserMessage(sessionId(), text);
    await chatStore.sendMessage(sessionId(), text);
  };

  const handleMessageAction = async (sid: string, action: MessageActionType, message: RenderedMessage) => {
    switch (action) {
      case 'copy':
        // Copy message content to clipboard
        const content = message.blocks
          .filter((b) => b.type === 'text')
          .map((b) => b.content)
          .join('\n');
        await navigator.clipboard.writeText(content);
        break;
      case 'edit': {
        const textContent = message.blocks
          .filter((b) => b.type === 'text')
          .map((b) => (b as any).content as string)
          .join('\n')
          .trim();
        setEditDraft(textContent);
        break;
      }
      case 'retry':
        // Retry regenerates from this point
        console.log('Retry action for message:', message);
        break;
      case 'branch':
        // Branch conversation
        console.log('Branch action for message:', message);
        break;
      case 'like':
      case 'dislike':
        // Feedback mechanism
        console.log('Feedback action:', action, 'for message:', message);
        break;
      case 'more':
        // More options (export, etc.)
        console.log('More action for message:', message);
        break;
    }
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
    untrack(async () => {
      await chatStore.loadMessages(sid);
      // If the session no longer exists (e.g. was deleted), redirect
      const exists = sessionStore.sessions.some((s) => s.id === sid);
      if (!exists) {
        const remaining = sessionStore.sessions;
        if (remaining.length > 0) {
          navigate(`/conversation/${remaining[0].id}`);
        } else {
          try {
            const meta = await sessionStore.createSession({});
            if (meta) navigate(`/conversation/${meta.id}`);
          } catch {
            // silently ignore
          }
        }
      }
    });
    // Reset scroll state when switching sessions
    setIsNearBottom(true);
    setUserScrolledUp(false);
    setUnreadCount(0);
    setLastMessageCount(0);
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

      <Show when={!modelStore.activeModel}>
        <div class={styles.noModelBanner}>
          <Icon name="alert-triangle" size={16} class={styles.noModelIcon} />
          <span class={styles.noModelText}>
            No model provider configured — messages cannot be sent until you add one.
          </span>
          <button
            type="button"
            class={styles.noModelBtn}
            onClick={() => navigate(ROUTES.MODEL)}
          >
            Configure
          </button>
        </div>
      </Show>

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
                ref={(el) => { messageListRef = el; }}
                class={styles.messageList}
                onScroll={handleScroll}
                style={{
                  "padding-bottom": (liveState().pendingApproval || liveState().pendingClarify) ? '60px' : undefined,
                }}
              >
                <For each={messages()}>
                  {(message, getIndex) => {
                    const idx = getIndex();
                    const onAction = (action: MessageActionType) =>
                      void handleMessageAction(sessionId(), action, message);
                    return (
                      <MessageBubble
                        message={message}
                        showDateSeparator={dateSeparators().has(idx)}
                        dateSeparatorLabel={dateSeparators().get(idx)}
                        onAction={onAction}
                      />
                    );
                  }}
                </For>
                <Show when={liveBlocks().length > 0}>
                  <AssistantMessage
                    blocks={liveBlocks()}
                    isStreaming={true}
                  />
                </Show>
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
            <JumpToBottom
              unreadCount={unreadCount()}
              visible={!isNearBottom() && messages().length > 0}
              onClick={() => {
                setUserScrolledUp(false);
                setUnreadCount(0);
                scrollToBottom({ force: true, behavior: 'smooth' });
              }}
            />
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
              disabled={isStreaming() || !modelStore.activeModel}
              isStreaming={isStreaming()}
              modelSlot={(dimmed) => <ModelSelector dimmed={dimmed} />}
              workspacePath={workspacePath()}
              isNewConversation={isEmpty()}
              onWorkspaceChange={(path) => {
                const sid = sessionId();
                if (sid) sessionStore.updateWorkspace(sid, path);
              }}
              editDraft={editDraft}
              clearEditDraft={() => setEditDraft(null)}
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
