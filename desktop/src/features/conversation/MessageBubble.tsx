import type { Component } from 'solid-js';
import { Show } from 'solid-js';
import type { RenderedMessage } from '@/types/index.js';
import type { MessageActionType } from '@/types/ui/message.js';
import type { TextBlock } from '@/types/ui/blocks.js';
import { UserMessage } from './UserMessage.js';
import { AssistantMessage } from './AssistantMessage.js';
import { ToolMessage } from './ToolMessage.js';
import { SystemMessage } from './SystemMessage.js';
import { DateSeparator } from './DateSeparator.js';
import styles from './MessageBubble.module.css';

interface MessageBubbleProps {
  message: RenderedMessage;
  showDateSeparator?: boolean;
  dateSeparatorLabel?: string;
  onAction?: (action: MessageActionType) => void;
  /** Passed to AssistantMessage to control retry button visibility. */
  isLast?: boolean;
  /** Passed to AssistantMessage to disable action buttons while streaming. */
  actionsDisabled?: boolean;
}

function hasRenderableAssistantBlocks(message: RenderedMessage): boolean {
  return message.blocks.some((block) => {
    switch (block.type) {
      case 'text':
      case 'code':
      case 'reasoning':
        return 'content' in block && String(block.content).trim().length > 0;
      case 'tool_call':
      case 'todo_list':
      case 'rich_content':
      case 'attachment':
        return true;
      default:
        return false;
    }
  });
}

export const MessageBubble: Component<MessageBubbleProps> = (props) => {
  const role = () => props.message.role;
  // User attachments are stored as an opaque snapshot (retry metadata + the
  // persisted/hydrated MessageAttachment shape). Pass through to UserMessage,
  // which normalizes both AttachmentChip ({kind,path}) and MessageAttachment
  // ({type,localPath}) shapes.
  const userAttachments = () => (props.message.attachments ?? []) as Array<Record<string, unknown>>;

  return (
    <div class={styles.wrapper}>
      <Show when={props.showDateSeparator && props.dateSeparatorLabel}>
        <DateSeparator label={props.dateSeparatorLabel!} />
      </Show>
      <Show when={role() === 'user'}>
        <UserMessage
          content={props.message.blocks
            .filter((b): b is TextBlock => b.type === 'text')
            .map((b) => b.content)
            .join('\n')}
          slashCommand={props.message.slashCommand}
          displayParts={props.message.displayParts}
          attachments={userAttachments()}
          timestamp={props.message.timestamp || undefined}
          deliveryStatus={props.message.deliveryStatus}
          failedReason={props.message.failedReason}
          onAction={props.onAction}
        />
      </Show>
      <Show when={role() === 'assistant' && hasRenderableAssistantBlocks(props.message)}>
        <AssistantMessage
          blocks={props.message.blocks}
          timestamp={props.message.timestamp || undefined}
          isStreaming={props.message.isStreaming}
          actions={props.message.actions}
          onAction={props.onAction}
          isLast={props.isLast}
          actionsDisabled={props.actionsDisabled}
          messageId={props.message.id}
        />
      </Show>
      <Show when={role() === 'tool'}>
        <ToolMessage
          toolName={props.message.toolName ?? 'tool'}
          content={props.message.blocks
            .filter((b): b is TextBlock => b.type === 'text')
            .map((b) => b.content)
            .join('\n')}
        />
      </Show>
      <Show when={role() === 'system'}>
        <SystemMessage
          content={props.message.blocks
            .filter((b): b is TextBlock => b.type === 'text')
            .map((b) => b.content)
            .join('\n')}
        />
      </Show>
    </div>
  );
};
