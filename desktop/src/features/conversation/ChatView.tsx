import type { Component } from 'solid-js';
import { Show, For, createEffect, onMount, createMemo, createSignal, Switch, Match, untrack } from 'solid-js';
import { useNavigate } from '@solidjs/router';
import type { TodoItem } from '@/types/gateway.js';
import type { RenderedMessage, TodoListBlock } from '@/types/index.js';
import type { MessageActionType } from '@/types/ui/message.js';
import { chatStore } from '@/stores/chat.js';
import { sessionUsage } from '@/stores/usage.js';
import { sidePanelStore } from '@/stores/side-panel.js';
import { gitViewStore } from '@/stores/git-view.js';
import { workspaceTreeStore } from '@/stores/workspace-tree.js';
import { sessionStore } from '@/stores/session.js';
import { modelStore } from '@/stores/models.js';
import { getGateway } from '@/stores/context.js';
import { ROUTES } from '@/routes';
import { MessageBubble } from './MessageBubble.js';
import { AssistantMessage } from './AssistantMessage.js';
import type { MessageBlock } from '@/types/index.js';
import { MessageInput } from './MessageInput.js';
import { CommandCardDock } from './cards/CommandCardDock.js';
import { ModelSelector } from './ModelSelector.js';
import { ChatToolbar } from './ChatToolbar.js';
import { WorkspaceSidePanel } from './WorkspaceSidePanel.js';
import { EmptyChatState } from './EmptyChatState.js';
import { ErrorBanner } from './ErrorBanner.js';
import { WorkspaceBanner } from './WorkspaceBanner.js';
import { Icon } from '@/ui/atoms/Icon.js';
import { ClarificationCard } from './ClarificationCard.js';
import { MemoryContextCard } from './MemoryContextCard.js';
import { TodoPanel } from './TodoPanel.js';
import { JumpToBottom } from './JumpToBottom.js';
import { PromptDock, type PromptDockItem } from './turn/PromptDock.js';
import { PermissionRequestCard } from './turn/PermissionRequestCard.js';
import { BackgroundTaskDock } from './background/BackgroundTaskDock.js';
import { backgroundTaskStore, recentBackgroundTasks } from '@/stores/background-tasks.js';
import { composerQueueStore, shouldAutoDrainOnSettle, type QueuedAttachment } from '@/stores/composer-queue.js';
import { createScrollController } from './scrollController.js';
import { createCommandCardState } from './commandCardState.js';
import { createSlashCommandRunner } from './slashCommandRunner.js';
import { useGatewayEvents } from './eventSubscription.js';
import styles from './ChatView.module.css';

interface ChatViewProps {
  sessionId?: string;
}

export const ChatView: Component<ChatViewProps> = (props) => {
  const navigate = useNavigate();
  const sessionId = () => props.sessionId ?? '';
  let chatBodyRef: HTMLDivElement | undefined;
  let diffPanelEl: HTMLDivElement | undefined;
  let dragHandleEl: HTMLDivElement | undefined;
  const [editDraft, setEditDraft] = createSignal<string | null>(null);
  let wasBusy = false;
  let suppressNextAutoDrain = false;

  const workspacePath = createMemo(() => sessionStore.activeSession?.workspace_path ?? null);
  const messages = (): RenderedMessage[] => chatStore.getMessages(sessionId());
  const liveState = () => chatStore.getLiveState(sessionId());
  const isStreaming = (): boolean => chatStore.isStreaming(sessionId());
  const error = (): string | null => chatStore.getError(sessionId());
  const isEmpty = createMemo(() => messages().length === 0);
  const canEditWorkspace = createMemo(() => !messages().some((m) => m.role === 'assistant'));
  const isLoading = () => chatStore.isLoadingMessages(sessionId());

  const liveBlocks = createMemo((): MessageBlock[] => {
    const live = liveState();
    const blocks: MessageBlock[] = [];
    if (live.reasoningText) {
      blocks.push({ type: 'reasoning', id: 'live-reasoning', content: live.reasoningText, isStreaming: true, tokenCount: null });
    }
    if (live.streamingText) {
      blocks.push({ type: 'text', id: 'live-text', content: live.streamingText });
    }
    return blocks;
  });

  const liveTools = createMemo(() => liveState().activeTools);

  const blockingPromptActive = createMemo(() =>
    Boolean(liveState().pendingPermission || liveState().pendingClarify)
  );

  // ── Extracted modules ─────────────────────────────────────────────────

  const scroll = createScrollController({
    getMessages: messages,
    getLiveBlocks: liveBlocks,
    getBlockingPromptActive: blockingPromptActive,
  });

  const cards = createCommandCardState();

  const sendPrompt = async (
    promptText: string,
    display?: { text: string; slashCommand?: { command: string; args: string } },
  ) => {
    chatStore.appendUserMessage(sessionId(), display?.text ?? promptText, display?.slashCommand);
    await chatStore.sendMessage(sessionId(), promptText);
  };

  const { handleSlashCommand } = createSlashCommandRunner({
    sessionId,
    getGateway,
    sendPrompt,
    noticeCard: cards.noticeCard,
    navigate,
  });

  useGatewayEvents({ getGateway });

  createEffect(() => {
    const sid = sessionId();
    const busy = isStreaming();
    const queueLength = composerQueueStore.getQueuedPrompts(sid).length;
    const shouldDrain = shouldAutoDrainOnSettle({
      wasBusy,
      isBusy: busy,
      queueLength,
      userInterrupted: suppressNextAutoDrain,
    });

    if (shouldDrain) {
      const next = composerQueueStore.dequeue(sid);
      if (next) {
        const queuedText = next.text.trim();
        if (queuedText.startsWith('/')) {
          void handleSlashCommand(queuedText);
        } else {
          void sendPrompt(next.text);
        }
      }
    }

    if (wasBusy && !busy) {
      suppressNextAutoDrain = false;
    }
    wasBusy = busy;
  });

  // ── Floating TodoPanel state ──────────────────────────────────────────

  const [panelManuallyClosed, setPanelManuallyClosed] = createSignal(false);
  const [panelExiting, setPanelExiting] = createSignal(false);
  const [isPaused, setIsPaused] = createSignal(false);
  const [showUndoBar, setShowUndoBar] = createSignal(false);
  const [incompleteCount, setIncompleteCount] = createSignal(0);
  let autoCloseTimer: ReturnType<typeof setTimeout> | undefined;
  let undoBarTimer: ReturnType<typeof setTimeout> | undefined;

  const hasActiveTodoTool = createMemo(() =>
    liveTools().some((t) => t.name === 'todo' && t.status === 'running')
  );

  const panelTodos = createMemo((): TodoItem[] => {
    const live = liveState();
    if (isStreaming() && live.todos.length > 0) return live.todos;
    const msgs = messages();
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i];
      if (m.role !== 'assistant') continue;
      const todoBlock = m.blocks.find((b): b is TodoListBlock => b.type === 'todo_list');
      if (todoBlock) return todoBlock.todos;
      break;
    }
    return [];
  });

  const allTodosComplete = createMemo(() => {
    const todos = panelTodos();
    return todos.length > 0 && todos.every((t) => t.status === 'completed' || t.status === 'cancelled');
  });

  const showFloatingPanel = createMemo(() =>
    !panelManuallyClosed() && (panelTodos().length > 0 || hasActiveTodoTool())
  );

  createEffect(() => {
    clearTimeout(autoCloseTimer);
    if (allTodosComplete() && showFloatingPanel() && !isPaused()) {
      autoCloseTimer = setTimeout(() => { doClosePanel(); }, 2000);
    }
  });

  createEffect(() => {
    if (isStreaming() && !hasActiveTodoTool() && liveState().todos.length === 0) {
      setPanelManuallyClosed(false);
      setIsPaused(false);
      setShowUndoBar(false);
    }
  });

  const doClosePanel = () => {
    setPanelExiting(true);
    setTimeout(() => {
      setPanelManuallyClosed(true);
      setPanelExiting(false);
      setShowUndoBar(false);
    }, 150);
  };

  const handleTodoPanelClose = () => {
    const todos = panelTodos();
    const incomplete = todos.filter((t) => t.status === 'pending' || t.status === 'in_progress');
    const hasIncomplete = incomplete.length > 0;
    if (hasIncomplete && isStreaming()) {
      void chatStore.cancelMessage(sessionId());
      setIsPaused(true);
    }
    if (hasIncomplete) {
      setIncompleteCount(incomplete.length);
      setShowUndoBar(true);
      undoBarTimer = setTimeout(() => {
        setShowUndoBar(false);
        doClosePanel();
      }, 5000);
    } else {
      doClosePanel();
    }
  };

  const handleUndoClose = () => {
    clearTimeout(undoBarTimer);
    setShowUndoBar(false);
    setPanelManuallyClosed(false);
    setIsPaused(false);
  };

  const handleTodoPanelPause = () => {
    if (isPaused()) {
      setIsPaused(false);
    } else {
      void chatStore.cancelMessage(sessionId());
      setIsPaused(true);
    }
  };

  // ── Date separators ───────────────────────────────────────────────────

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

  // ── Side panel drag ───────────────────────────────────────────────────

  const handleDragStart = (e: MouseEvent) => {
    e.preventDefault();
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
      if (diffPanelEl) { diffPanelEl.style.transition = ''; diffPanelEl.style.willChange = ''; }
      if (dragHandleEl) dragHandleEl.classList.remove(styles.dragHandleActive);
      if (chatBodyRef) chatBodyRef.classList.remove(styles.chatBodyDragging);
      sidePanelStore.setPanelWidth(lastWidth);
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  // ── Session loading & model sync ──────────────────────────────────────

  createEffect(() => {
    const sid = sessionId();
    if (!sid) return;
    sessionStore.setActiveSession(sid);
    untrack(async () => {
      await chatStore.loadMessages(sid);
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
    scroll.resetScrollState();
  });

  createEffect(() => {
    const sid = sessionStore.activeSessionId;
    if (!sid) return;
    const cached = sessionStore.getSessionModel(sid);
    if (cached) {
      modelStore.hydrateActiveModel(cached.provider, cached.model);
      return;
    }
    const session = sessionStore.activeSession;
    if (session?.provider && session?.model) {
      modelStore.hydrateActiveModel(session.provider, session.model);
    }
  });

  createEffect(() => {
    const path = workspacePath();
    gitViewStore.setWorkspacePath(path);
    void workspaceTreeStore.setWorkspacePath(path);
    if (path && sidePanelStore.isOpen() && sidePanelStore.activeTab() === 'git') {
      void gitViewStore.fetchDiff();
    }
  });

  createEffect(() => {
    if (sidePanelStore.isOpen() && sidePanelStore.activeTab() === 'git' && workspacePath()) {
      void gitViewStore.fetchDiff();
    }
  });

  // ── Message action handler ────────────────────────────────────────────

  const handleMessageAction = async (sid: string, action: MessageActionType, message: RenderedMessage) => {
    switch (action) {
      case 'copy': {
        const content = message.blocks.filter((b) => b.type === 'text').map((b) => b.content).join('\n');
        await navigator.clipboard.writeText(content);
        break;
      }
      case 'edit': {
        const textContent = message.blocks.filter((b) => b.type === 'text').map((b) => (b as any).content as string).join('\n').trim();
        setEditDraft(textContent);
        break;
      }
      case 'retry': {
        if (isStreaming()) break;
        const gateway = getGateway();
        if (!gateway) break;
        const lastUserText = chatStore.removeLastTurn(sid);
        if (!lastUserText) break;
        try { await gateway.session.undo(sid); } catch { /* proceed anyway */ }
        await sendPrompt(lastUserText);
        break;
      }
      case 'branch': {
        const meta = await sessionStore.branchSession(sid);
        if (meta) navigate(`/conversation/${meta.id}`);
        break;
      }
      case 'undo': {
        if (isStreaming()) break;
        const gateway = getGateway();
        if (!gateway) break;
        chatStore.removeLastTurn(sid);
        try { await gateway.session.undo(sid); } catch { /* UI already updated */ }
        break;
      }
    }
  };

  // ── Handlers ──────────────────────────────────────────────────────────

  const handleSend = async (text: string, attachments?: QueuedAttachment[]) => {
    const trimmed = text.trim();
    if (isStreaming()) {
      const entry = composerQueueStore.enqueue(sessionId(), { text: trimmed || text, attachments });
      if (entry) cards.noticeCard('Queued for the next turn.');
      return;
    }
    if (trimmed.startsWith('/')) {
      await handleSlashCommand(trimmed);
      return;
    }
    cards.setCommandCard(null);
    await sendPrompt(text);
  };

  const handleMaskedPermissionSubmit = (requestId: string, value: string) => {
    const permission = liveState().pendingPermission;
    if (!permission) return;
    if (permission.kind === 'sudo') {
      void chatStore.respondSudo(sessionId(), requestId, value);
    } else if (permission.kind === 'secret') {
      void chatStore.respondSecret(sessionId(), requestId, value);
    }
  };

  const handlePermissionCancel = () => {
    const permission = liveState().pendingPermission;
    if (!permission) return;
    if (permission.kind === 'approval') {
      void chatStore.respondApproval(sessionId(), 'deny');
    } else if (permission.kind === 'sudo' && permission.requestId) {
      void chatStore.respondSudo(sessionId(), permission.requestId, '');
    } else if (permission.kind === 'secret' && permission.requestId) {
      void chatStore.respondSecret(sessionId(), permission.requestId, '');
    }
  };

  // ── Prompt dock items ─────────────────────────────────────────────────

  const promptDockItems = createMemo<PromptDockItem[]>(() => {
    const items: PromptDockItem[] = [];
    const live = liveState();
    const permission = live.pendingPermission;
    const clarify = live.pendingClarify;

    if (permission) {
      items.push({
        id: `permission-${permission.kind}-${permission.requestId ?? permission.command}`,
        content: (
          <PermissionRequestCard
            permission={permission}
            onApprovalChoice={(choice) => void chatStore.respondApproval(sessionId(), choice)}
            onMaskedSubmit={handleMaskedPermissionSubmit}
            onCancel={handlePermissionCancel}
          />
        ),
      });
    }

    if (clarify) {
      items.push({
        id: `clarify-${clarify.requestId}`,
        content: (
          <ClarificationCard
            question={clarify.question}
            choices={clarify.choices}
            onRespond={(text) => void chatStore.respondClarify(sessionId(), clarify.requestId, text)}
          />
        ),
      });
    }

    if (!permission && !clarify && (showFloatingPanel() || panelExiting())) {
      items.push({
        id: 'todo-panel',
        content: (
          <>
            <TodoPanel
              todos={panelTodos()}
              isStreaming={isStreaming()}
              isPaused={isPaused()}
              floating
              exiting={panelExiting()}
              onClose={handleTodoPanelClose}
              onPause={handleTodoPanelPause}
            />
            <Show when={showUndoBar()}>
              <div class={styles.undoBar}>
                <span>Chat paused · {incompleteCount()} task{incompleteCount() !== 1 ? 's' : ''} incomplete</span>
                <button class={styles.undoBtn} onClick={handleUndoClose}>Undo</button>
              </div>
            </Show>
          </>
        ),
      });
    }

    if (!permission && !clarify && cards.commandCard()) {
      items.push({
        id: 'command-card',
        content: <CommandCardDock card={cards.commandCard()!} embedded onDismiss={cards.dismissCommandCard} />,
      });
    }

    const backgroundTasks = recentBackgroundTasks().slice(0, 3);
    if (!permission && !clarify && backgroundTasks.length > 0) {
      items.push({
        id: 'background-tasks',
        content: (
          <BackgroundTaskDock
            tasks={backgroundTasks}
            onDismiss={(id) => backgroundTaskStore.dismiss(id)}
          />
        ),
      });
    }

    return items;
  });

  // ── Render ────────────────────────────────────────────────────────────

  return (
    <div class={styles.chatView}>
      <ChatToolbar
        workspacePath={workspacePath()}
        sessionTitle={sessionStore.activeSession?.title}
        sidePanelActive={sidePanelStore.isOpen()}
        onToggleSidePanel={() => sidePanelStore.toggle('workspace')}
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
          <button type="button" class={styles.noModelBtn} onClick={() => navigate(ROUTES.MODEL)}>
            Configure
          </button>
        </div>
      </Show>

      <Show when={liveState().memoryContext}>
        <MemoryContextCard items={liveState().memoryContext!} onEdit={() => {}} />
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
                ref={(el) => { scroll.refs.messageList = el; }}
                class={styles.messageList}
                onScroll={scroll.handleScroll}
                style={{ "padding-bottom": blockingPromptActive() ? '60px' : undefined }}
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
                        isLast={idx === messages().length - 1}
                        actionsDisabled={isStreaming()}
                      />
                    );
                  }}
                </For>
                <Show when={liveBlocks().length > 0 || liveTools().length > 0}>
                  <AssistantMessage
                    blocks={liveBlocks()}
                    isStreaming={true}
                    liveTools={liveTools()}
                  />
                </Show>
                <div ref={scroll.refs.messagesEnd} />
              </div>
            </Match>
          </Switch>

          <div class={styles.inputArea}>
            <JumpToBottom
              unreadCount={scroll.unreadCount()}
              visible={!scroll.isNearBottom() && messages().length > 0}
              onClick={() => {
                scroll.setUserScrolledUp(false);
                scroll.setUnreadCount(() => 0);
                scroll.scrollToBottom({ force: true, behavior: 'smooth' });
              }}
            />
            <PromptDock items={promptDockItems()} />

            <MessageInput
              onSend={handleSend}
              onStop={() => {
                suppressNextAutoDrain = true;
                void chatStore.cancelMessage(sessionId());
              }}
              disabled={blockingPromptActive() || !modelStore.activeModel}
              isStreaming={isStreaming()}
              modelSlot={(dimmed, disabled) => <ModelSelector sessionId={sessionId()} dimmed={dimmed} disabled={disabled} />}
              workspacePath={workspacePath()}
              isNewConversation={canEditWorkspace()}
              onWorkspaceChange={(path) => {
                const sid = sessionId();
                if (sid) sessionStore.updateWorkspace(sid, path);
              }}
              editDraft={editDraft}
              clearEditDraft={() => setEditDraft(null)}
              contextUsage={sessionUsage.get(sessionId())}
            />
          </div>
        </div>

        <Show when={sidePanelStore.isOpen()}>
          <div class={styles.diffSeparator} />
          <div
            ref={(el) => { dragHandleEl = el; }}
            class={styles.dragHandle}
            onMouseDown={handleDragStart}
          />
        </Show>
        <Show when={sidePanelStore.isOpen()}>
          <WorkspaceSidePanel
            ref={(el: HTMLDivElement) => { diffPanelEl = el; }}
            workspacePath={workspacePath()}
            panelWidth={sidePanelStore.panelWidth()}
          />
        </Show>
      </div>
    </div>
  );
};
