import type { Component } from 'solid-js';
import { Show, createSignal } from 'solid-js';
import { Icon } from '@/ui/atoms/Icon.js';
import { Modal } from '@/ui/molecules/Modal.js';
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
  const [open, setOpen] = createSignal(false);

  return (
    <>
      <div class={styles.chip}>
        <Icon name="file-text" size={14} class={styles.fileIcon} />
        <span class={styles.fileName}>{props.name}</span>
        <span class={styles.size}>{formatFileSize(props.size)}</span>
        <Show when={props.preview}>
          <button class={styles.viewBtn} onClick={() => setOpen(true)}>
            View
          </button>
        </Show>
        <Show when={props.onDownload}>
          <button class={styles.downloadBtn} onClick={() => props.onDownload?.()}>
            <Icon name="download" size={12} />
          </button>
        </Show>
      </div>
      <Modal
        open={open()}
        title={props.name}
        onClose={() => setOpen(false)}
        style={{ 'max-width': 'min(80vw, 900px)' }}
      >
        <pre class={styles.previewContent}>{props.preview}</pre>
      </Modal>
    </>
  );
};
