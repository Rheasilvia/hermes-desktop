import type { Component } from 'solid-js';
import { Show, createMemo, For } from 'solid-js';
import type { SessionMessage } from '@/types/session.js';
import { parseMarkdown } from '@/utils/markdown.js';
import { ToolCard } from './ToolCard.js';
import styles from './MessageBubble.module.css';

interface MessageBubbleProps {
  message: SessionMessage;
}

function formatTimestamp(ts: string): string {
  try {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

export const MessageBubble: Component<MessageBubbleProps> = (props) => {
  const role = () => props.message.role;
  const isUser = () => role() === 'user';
  const isAssistant = () => role() === 'assistant';
  const isTool = () => role() === 'tool';

  const bubbleClass = () => {
    if (isUser()) return `${styles.bubble} ${styles.userBubble}`;
    if (isAssistant()) return `${styles.bubble} ${styles.assistantBubble}`;
    return `${styles.bubble} ${styles.toolBubble}`;
  };

  const renderedContent = createMemo(() => {
    const content = props.message.content;
    if (!content) return '';
    if (isAssistant()) return parseMarkdown(content);
    return content;
  });

  const toolCalls = createMemo(() => {
    const tc = props.message.tool_calls;
    if (!tc || !Array.isArray(tc)) return [];
    return tc as Array<{ id: string; type: string; function: { name: string; arguments: string } }>;
  });

  return (
    <div class={styles.bubbleRow}>
      <Show when={isTool()}>
        <ToolCard
          name={props.message.tool_name ?? 'unknown'}
          args={props.message.content ?? undefined}
          status="complete"
        />
      </Show>

      <Show when={!isTool()}>
        <div class={styles.bubbleWrapper}>
          <div class={bubbleClass()}>
            <Show when={isAssistant() && props.message.reasoning}>
              <div class={styles.reasoningBlock}>{props.message.reasoning}</div>
            </Show>
            <Show when={isAssistant() && renderedContent()}>
              <div class={styles.markdownContent} innerHTML={renderedContent()} />
            </Show>
            <Show when={isUser() && renderedContent()}>
              <div>{renderedContent()}</div>
            </Show>
            <Show when={isAssistant() && toolCalls().length > 0}>
              <For each={toolCalls()}>
                {(tc) => (
                  <ToolCard
                    name={tc.function.name}
                    args={tc.function.arguments}
                    status="complete"
                  />
                )}
              </For>
            </Show>
          </div>
          <Show when={props.message.timestamp}>
            <span class={styles.timestamp}>{formatTimestamp(props.message.timestamp)}</span>
          </Show>
        </div>
      </Show>
    </div>
  );
};
