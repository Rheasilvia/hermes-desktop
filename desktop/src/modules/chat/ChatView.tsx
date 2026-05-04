import type { Component } from 'solid-js';
import { Show, For, createEffect, onMount, onCleanup, createMemo, createSignal } from 'solid-js';
import type { SessionMessage } from '@/types/session.js';
import type { MessageDelta } from '@/types/message.js';
import type {
  MessageDeltaPayload,
  MessageCompletePayload,
  ToolStartPayload,
  ToolProgressPayload,
  ToolCompletePayload,
} from '@/types/gateway.js';
import { chatStore } from '@/stores/chat.js';
import { getGateway } from '@/stores/context.js';
import { MessageBubble } from './MessageBubble.js';
import { MessageInput } from './MessageInput.js';
import { StreamingIndicator } from './StreamingIndicator.js';
import { ModelSelector } from './ModelSelector.js';
import { Icon } from '@/components/Icon';
import { AsciiBanner } from '@/components/AsciiBanner';
import styles from './ChatView.module.css';

interface ChatViewProps {
  sessionId?: string;
}

interface ActiveTool {
  id: string;
  name: string;
  args?: string;
  result?: string;
  status: 'running' | 'complete' | 'error';
}

export const ChatView: Component<ChatViewProps> = (props) => {
  const sessionId = () => props.sessionId ?? 'sess_abc123';
  let messagesEndRef: HTMLDivElement | undefined;
  const [activeTools, setActiveTools] = createSignal<Map<string, ActiveTool>>(new Map());

  const messages = (): SessionMessage[] => chatStore.getMessages(sessionId());
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
    const userMessage: SessionMessage = {
      session_id: sessionId(),
      role: 'user',
      content: text,
      tool_call_id: null,
      tool_calls: null,
      tool_name: null,
      timestamp: new Date().toISOString(),
      token_count: 0,
      finish_reason: null,
      reasoning: null,
      reasoning_details: null,
      codex_reasoning_items: null,
    };
    chatStore.appendMessage(sessionId(), userMessage);
    await chatStore.sendMessage(sessionId(), text);
  };

  const onMessageDelta = (payload: MessageDeltaPayload) => {
    const delta: MessageDelta = {
      text: payload.text,
      reasoning: payload.reasoning,
      finish_reason: undefined,
    };
    chatStore.handleDelta(sessionId(), delta);
  };

  const onMessageComplete = (_payload: MessageCompletePayload) => {
    chatStore.handleMessageComplete(sessionId());
  };

  const onToolStart = (payload: ToolStartPayload) => {
    setActiveTools((prev: Map<string, ActiveTool>) => {
      const next = new Map(prev);
      next.set(payload.tool_id, {
        id: payload.tool_id,
        name: payload.name,
        status: 'running',
      });
      return next;
    });
  };

  const onToolProgress = (_payload: ToolProgressPayload) => {
    void undefined;
  };

  const onToolComplete = (payload: ToolCompletePayload) => {
    setActiveTools((prev: Map<string, ActiveTool>) => {
      const next = new Map(prev);
      const existing = next.get(payload.tool_id);
      if (existing) {
        next.set(payload.tool_id, { ...existing, status: 'complete' });
      }
      return next;
    });
  };

  onMount(() => {
    const gateway = getGateway();
    if (!gateway) return;

    gateway.on('message.delta', onMessageDelta);
    gateway.on('message.complete', onMessageComplete);
    gateway.on('tool.start', onToolStart);
    gateway.on('tool.progress', onToolProgress);
    gateway.on('tool.complete', onToolComplete);

    void chatStore.loadMessages(sessionId());
  });

  onCleanup(() => {
    const gateway = getGateway();
    if (!gateway) return;

    gateway.off('message.delta', onMessageDelta);
    gateway.off('message.complete', onMessageComplete);
    gateway.off('tool.start', onToolStart);
    gateway.off('tool.progress', onToolProgress);
    gateway.off('tool.complete', onToolComplete);
  });

  return (
    <div class={styles.chatView}>
      <div class={styles.toolbar}>
        <div class={styles.toolbarLeft}>
          <ModelSelector />
        </div>
        <div class={styles.toolbarRight}>
          <button class={styles.toolbarBtn} title="More options" type="button">
            <Icon name="more-horizontal" size={16} />
          </button>
        </div>
      </div>

      <Show when={error()}>
        <div class={styles.errorBanner}>{error()}</div>
      </Show>

      <Show
        when={!isEmpty()}
        fallback={
          <div class={styles.emptyState}>
            <AsciiBanner class={styles.emptyBanner} />
            <div class={styles.emptyTitle}>Start a conversation</div>
            <div class={styles.emptyDescription}>
              Send a message to begin chatting with Hermes. You can ask questions, run commands,
              search the web, and more.
            </div>
          </div>
        }
      >
        <div class={styles.messageList}>
          <For each={messages()}>
            {(message) => <MessageBubble message={message} />}
          </For>
          <Show when={activeTools().size > 0}>
            <For each={Array.from(activeTools().values())}>
              {(tool: ActiveTool) => (
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
      </Show>

      <MessageInput
        onSend={handleSend}
        disabled={isStreaming()}
      />
    </div>
  );
};
