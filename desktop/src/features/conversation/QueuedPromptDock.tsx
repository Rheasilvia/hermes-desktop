import type { Component } from 'solid-js';
import { For, Show } from 'solid-js';
import type { QueuedAttachment, QueuedPromptEntry } from '@/stores/composer-queue.js';
import { Icon, type IconName } from '@/ui/atoms/Icon.js';
import styles from './QueuedPromptDock.module.css';

interface QueuedPromptDockProps {
  entries: QueuedPromptEntry[];
  onRemove: (id: string) => void;
  canSteerFirst?: boolean;
  steerDisabledReason?: string;
  warning?: string | null;
  onSteerFirst?: () => void;
}

const visibleAttachmentLimit = 3;

function iconForKind(kind: QueuedAttachment['kind']): IconName {
  switch (kind) {
    case 'folder': return 'folder';
    case 'image': return 'image';
    case 'url': return 'globe';
    case 'terminal': return 'terminal';
    case 'file':
    default: return 'file-code';
  }
}

function previewFor(entry: QueuedPromptEntry): string {
  const text = entry.text.trim();
  return text.length > 0 ? text : 'Attachment-only message';
}

function attachmentLabel(count: number): string {
  return count === 1 ? '1 attachment' : `${count} attachments`;
}

export const QueuedPromptDock: Component<QueuedPromptDockProps> = (props) => (
  <section class={styles.panel} aria-label="Queued follow-up messages" data-testid="queued-prompt-dock">
    <div class={styles.header}>
      <div class={styles.titleGroup}>
        <Icon name="message-square" size={14} class={styles.titleIcon} />
        <span class={styles.title}>Queued follow-up</span>
        <span class={styles.countBadge}>{props.entries.length}</span>
      </div>
      <div class={styles.headerActions}>
        <span class={styles.status}>
          <span class={styles.statusDot} aria-hidden="true" />
          Sends after current turn
        </span>
        <Show when={props.entries.length > 0}>
          <button
            class={styles.steerButton}
            type="button"
            aria-label="Steer first queued follow-up"
            title={props.canSteerFirst
              ? 'Steer first queued follow-up'
              : props.steerDisabledReason ?? 'Steer is unavailable for this queued follow-up.'}
            disabled={!props.canSteerFirst}
            onClick={() => props.onSteerFirst?.()}
          >
            <Icon name="arrow-up" size={13} />
            <span>Steer</span>
          </button>
        </Show>
      </div>
    </div>

    <Show when={props.warning}>
      <div class={styles.warningTip} role="status">
        <Icon name="alert-triangle" size={13} class={styles.warningIcon} />
        <span>{props.warning}</span>
      </div>
    </Show>

    <div class={styles.list}>
      <For each={props.entries}>
        {(entry, index) => (
          <article class={styles.item} data-testid="queued-prompt-item">
            <div class={styles.itemMain}>
              <div class={styles.itemMeta}>
                <span class={styles.position}>#{index() + 1}</span>
                <Show when={entry.attachments.length > 0}>
                  <span>{attachmentLabel(entry.attachments.length)}</span>
                </Show>
              </div>
              <p class={styles.preview} title={entry.text.trim() || undefined}>
                {previewFor(entry)}
              </p>
              <Show when={entry.attachments.length > 0}>
                <div class={styles.attachments} aria-label={`Queued attachments for item ${index() + 1}`}>
                  <For each={entry.attachments.slice(0, visibleAttachmentLimit)}>
                    {(attachment) => (
                      <span class={styles.attachmentChip} title={attachment.path ?? attachment.name}>
                        <Icon name={iconForKind(attachment.kind)} size={11} class={styles.attachmentIcon} />
                        <span>{attachment.name}</span>
                      </span>
                    )}
                  </For>
                  <Show when={entry.attachments.length > visibleAttachmentLimit}>
                    <span class={styles.moreChip}>+{entry.attachments.length - visibleAttachmentLimit}</span>
                  </Show>
                </div>
              </Show>
            </div>
            <button
              class={styles.removeButton}
              type="button"
              aria-label="Remove queued message"
              title="Remove queued message"
              onClick={() => props.onRemove(entry.id)}
            >
              <Icon name="trash-2" size={13} />
            </button>
          </article>
        )}
      </For>
    </div>
  </section>
);
