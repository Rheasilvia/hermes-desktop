import type { Component } from 'solid-js';
import { For, Show, createEffect, createSignal } from 'solid-js';
import { Icon } from '@/ui/atoms/Icon.js';
import { MessageActionBar, type MessageActionType } from './MessageActionBar.js';
import { fileRefLabel, type UserDisplayPart, type UserFileRefDisplayPart } from './display-parts.js';
import { ImageCard } from './ImageCard.js';
import styles from './UserMessage.module.css';

interface UserMessageProps {
  content: string;
  displayParts?: UserDisplayPart[] | null;
  /** Image/file attachments carried with this message. Accepts both the
   *  optimistic AttachmentChip shape ({kind, path}) and the persisted
   *  MessageAttachment shape ({type, localPath}). Image entries render as
   *  thumbnails above the text bubble. */
  attachments?: Array<Record<string, unknown>>;
  /** When set, this message was a slash command — render the command label
   *  above the typed content instead of the raw (expanded) text. */
  slashCommand?: { command: string; args: string };
  timestamp?: number;
  deliveryStatus?: 'failed';
  failedReason?: string;
  onAction?: (action: MessageActionType) => void;
  isEditing?: boolean;
  editDraft?: string;
  editPending?: boolean;
  editError?: string | null;
  editDisabledReason?: string | null;
  onEditDraftChange?: (value: string) => void;
  onEditCancel?: () => void;
  onEditConfirm?: () => void;
}

function formatTimestamp(ts: number): string {
  try {
    return new Date(ts * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

export const UserMessage: Component<UserMessageProps> = (props) => {
  const [showActions, setShowActions] = createSignal(false);
  let editTextareaRef: HTMLTextAreaElement | undefined;
  // Display parts that contribute to the text bubble (file_ref chips + text).
  // Image parts render in the gallery above, NOT in the bubble.
  const bubbleParts = () =>
    (props.displayParts ?? []).filter((p) => p.type === 'file_ref' || p.type === 'text');
  // Attachments arrive in one of two shapes: the optimistic send path stores
  // AttachmentChips ({kind:'image', path}), while the persisted/hydrated path
  // stores MessageAttachments ({type:'image', localPath}). Normalize both.
  const imageAttachments = () =>
    (props.attachments ?? [])
      .map((a) => {
        const isImage = (a as { kind?: string; type?: string }).kind === 'image'
          || (a as { kind?: string; type?: string }).type === 'image';
        const path = (a as { path?: string; localPath?: string }).path
          ?? (a as { path?: string; localPath?: string }).localPath;
        const name = (a as { name?: string }).name ?? 'image';
        return isImage && path ? { path, name } : null;
      })
      .filter((x): x is { path: string; name: string } => x !== null);
  const editConfirmDisabled = () =>
    !!props.editPending || !!props.editDisabledReason || !(props.editDraft ?? '').trim();

  createEffect(() => {
    if (!props.isEditing) return;
    queueMicrotask(() => {
      editTextareaRef?.focus();
      editTextareaRef?.setSelectionRange(editTextareaRef.value.length, editTextareaRef.value.length);
    });
  });

  const handleEditKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      props.onEditCancel?.();
    }
  };

  return (
    <div
      class={styles.row}
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
    >
      <div class={styles.content}>
        <Show when={imageAttachments().length > 0}>
          <div class={styles.imageGallery} role="group" aria-label="Attached images">
            <For each={imageAttachments()}>
              {(img) => <ImageCard url={img.path} altText={img.name} compact />}
            </For>
          </div>
        </Show>
        <Show
          when={props.isEditing}
          fallback={
            <div class={styles.bubble} classList={{ [styles.commandBubble]: !!props.slashCommand, [styles.inlinePartsBubble]: bubbleParts().length > 0 }}>
              <Show
                when={bubbleParts().length}
                fallback={
                  <Show when={props.slashCommand} fallback={props.content}>
                    <span class={styles.commandLabel}>
                      <Icon name="zap" size={12} />
                      <span class={styles.commandName}>/{props.slashCommand!.command}</span>
                    </span>
                    <Show when={props.slashCommand!.args}>
                      <span class={styles.commandArgs}>{props.slashCommand!.args}</span>
                    </Show>
                  </Show>
                }
              >
                <For each={bubbleParts()}>
                  {(part) => (
                    <Show
                      when={part.type === 'file_ref'}
                      fallback={<span class={styles.inlineText}>{part.type === 'text' ? part.text : ''}</span>}
                    >
                      <span class={styles.inlineFileChip} title={(part as UserFileRefDisplayPart).refText}>
                        <Icon name="file-code" size={12} />
                        <span>{fileRefLabel(part as UserFileRefDisplayPart)}</span>
                      </span>
                    </Show>
                  )}
                </For>
              </Show>
            </div>
          }
        >
          <div class={styles.editCard}>
            <textarea
              ref={editTextareaRef}
              class={styles.editTextarea}
              value={props.editDraft ?? ''}
              aria-label="Edit user message"
              disabled={!!props.editPending}
              onInput={(event) => props.onEditDraftChange?.(event.currentTarget.value)}
              onKeyDown={handleEditKeyDown}
            />
            <Show when={props.editError || props.editDisabledReason}>
              <div class={styles.editError} role="alert">
                {props.editError || props.editDisabledReason}
              </div>
            </Show>
            <div class={styles.editActions}>
              <button
                type="button"
                class={styles.editButton}
                disabled={!!props.editPending}
                onClick={() => props.onEditCancel?.()}
              >
                Cancel
              </button>
              <button
                type="button"
                class={`${styles.editButton} ${styles.editPrimaryButton}`}
                disabled={editConfirmDisabled()}
                title={props.editDisabledReason ?? undefined}
                onClick={() => props.onEditConfirm?.()}
              >
                <Icon name="refresh-cw" size={13} />
                <span>{props.editPending ? 'Restoring...' : 'Restore & rerun'}</span>
              </button>
            </div>
          </div>
        </Show>
        <Show when={props.timestamp}>
          <span class={styles.timestamp}>{formatTimestamp(props.timestamp!)}</span>
        </Show>
        <Show when={props.deliveryStatus === 'failed'}>
          <div class={styles.failedRow}>
            <Icon name="alert-circle" size={13} />
            <span>{props.failedReason ?? 'Failed to send message'}</span>
            <Show when={props.onAction}>
              <button
                type="button"
                class={styles.retryBtn}
                onClick={() => props.onAction?.('retry')}
              >
                <Icon name="refresh-cw" size={12} />
                <span>Retry</span>
              </button>
            </Show>
          </div>
        </Show>
        <Show when={!props.isEditing && showActions() && props.onAction}>
          <MessageActionBar variant="user" onAction={props.onAction!} />
        </Show>
      </div>
      <div class={styles.avatar}>U</div>
    </div>
  );
};
