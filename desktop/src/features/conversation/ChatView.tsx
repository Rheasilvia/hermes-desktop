import type { Component } from 'solid-js';
import { Show, For, createEffect, onMount, onCleanup, createMemo, createSignal, Switch, Match } from 'solid-js';
import type {
  MessageDeltaPayload,
  MessageCompletePayload,
  ToolStartPayload,
  ToolProgressPayload,
  ToolCompletePayload,
  ToolGeneratingPayload,
  ReasoningDeltaPayload,
} from '@/types/gateway.js';
import type { RenderedMessage } from '@/types/index.js';
import { chatStore } from '@/stores/chat.js';
import { diffStore } from '@/stores/chat.js';
import { sessionStore } from '@/stores/session.js';
import { getGateway } from '@/stores/context.js';
import { MessageBubble } from './MessageBubble.js';
import { MessageInput } from './MessageInput.js';
import { StreamingIndicator } from './StreamingIndicator.js';
import { ModelSelector } from './ModelSelector.js';
import { ChatToolbar } from './ChatToolbar.js';
import { WorkspaceBanner } from './WorkspaceBanner.js';
import { DiffPanel } from '@/features/diff/DiffPanel.js';
import { AsciiBanner } from '@/ui/organisms/AsciiBanner';
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

  createEffect(() => {
    const msgs = messages();
    if (msgs.length > 0) {
      scrollToBottom();
    }
  });

  const scrollToBottom = () => {
    requestAnimationFrame(() => {
      messagesEndRef?.scrollIntoView({ behavior: 'smooth' });
    });
  };

  const handleSend = async (text: string) => {
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

  onMount(() => {
    if (!props.sessionId) return;
    sessionStore.setActiveSession(props.sessionId);
    diffStore.setWorkspacePath(workspacePath());
    const gateway = getGateway();
    if (!gateway) return;

    gateway.on('message.delta', onMessageDelta);
    gateway.on('message.complete', onMessageComplete);
    gateway.on('reasoning.delta', onReasoningDelta);
    gateway.on('tool.start', onToolStart);
    gateway.on('tool.progress', onToolProgress);
    gateway.on('tool.complete', onToolComplete);
    gateway.on('tool.generating', onToolGenerating);

    void chatStore.loadMessages(sessionId());
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
  });

  return (
    <div class={styles.chatView}>
      <ChatToolbar
        workspacePath={workspacePath()}
        splitScreenActive={diffStore.isDiffOpen()}
        onToggleSplitScreen={() => diffStore.toggleDiff()}
        modelSelectorSlot={<ModelSelector />}
      />

      <Show when={error()}>
        <div class={styles.errorBanner}>{error()}</div>
      </Show>

      <div class={styles.chatBody} ref={chatBodyRef}>
        <div class={styles.chatPane}>
          <Switch>
            <Match when={isEmpty()}>
              <div class={styles.emptyState}>
                <AsciiBanner class={styles.emptyBanner} />
                <div class={styles.emptyTitle}>Start a conversation</div>
                <div class={styles.emptyDescription}>
                  Send a message to begin chatting with Hermes. You can ask questions, run commands,
                  search the web, and more.
                </div>
              </div>
            </Match>
            <Match when={true}>
              <div class={styles.messageList}>
                <For each={messages()}>
                  {(message) => <MessageBubble message={message} />}
                </For>
                <Show when={liveState().activeTools.length > 0}>
                  <For each={liveState().activeTools}>
                    {(tool) => (
                      <div style={{ "margin-bottom": "var(--space-4)" }}>
                        {tool.name}
                      </div>
                    )}
                  </For>
                </Show>
                <Show when={isStreaming()}>
                  <StreamingIndicator />
                </Show>
                <div ref={messagesEndRef} />
              </div>
            </Match>
          </Switch>

          <WorkspaceBanner workspacePath={workspacePath()} />

          <MessageInput
            onSend={handleSend}
            disabled={isStreaming()}
          />
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
