import type { Component } from 'solid-js';
import { Show } from 'solid-js';
import { Icon } from '@/ui/atoms/Icon.js';
import styles from './FileAttachmentCard.module.css';

interface FileAttachmentCardProps {
  name: string;
  size: number;
  mimeType: string;
  preview?: string | null;
  onView?: () => void;
  onDownload?: () => void;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const FileAttachmentCard: Component<FileAttachmentCardProps> = (props) => {
  return (
    <div class={styles.container}>
      <Icon name="file" size={20} class={styles.fileIcon} />
      <div class={styles.info}>
        <span class={styles.fileName}>{props.name}</span>
        <span class={styles.metadata}>
          {formatFileSize(props.size)} &middot; {props.mimeType}
        </span>
      </div>
      <div class={styles.actions}>
        <Show when={props.onView}>
          <button class={styles.actionBtn} onClick={() => props.onView?.()}>
            View
          </button>
        </Show>
        <Show when={props.onDownload}>
          <button class={styles.downloadBtn} onClick={() => props.onDownload?.()}>
            <Icon name="download" size={14} />
          </button>
        </Show>
      </div>
    </div>
  );
};
