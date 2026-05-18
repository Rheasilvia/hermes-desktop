import type { Component } from 'solid-js';
import { Show, createSignal } from 'solid-js';
import { Icon, type IconName } from '@/ui/atoms/Icon.js';
import { Modal } from '@/ui/molecules/Modal.js';
import styles from './FileAttachmentCard.module.css';

interface FileAttachmentCardProps {
  name: string;
  size: number;
  mimeType: string;
  preview?: string | null;
  onDownload?: () => void;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function typeLabel(mime: string): string {
  if (mime.includes('python')) return 'Python source';
  if (mime === 'text/plain') return 'Plain text';
  if (mime.includes('javascript') || mime.includes('typescript')) return 'JS/TS source';
  if (mime.includes('json')) return 'JSON';
  if (mime.includes('markdown')) return 'Markdown';
  if (mime.includes('pdf')) return 'PDF';
  if (mime.startsWith('text/')) return 'Text file';
  return 'File';
}

function fileIcon(mime: string): IconName {
  if (
    mime.includes('python') ||
    mime.includes('javascript') ||
    mime.includes('typescript') ||
    mime.includes('json') ||
    mime.includes('xml')
  ) return 'file-code';
  return 'file-text';
}

export const FileAttachmentCard: Component<FileAttachmentCardProps> = (props) => {
  const [open, setOpen] = createSignal(false);

  return (
    <>
      <div class={styles.card}>
        <div class={styles.iconBox}>
          <Icon name={fileIcon(props.mimeType)} size={20} class={styles.fileIcon} />
        </div>
        <div class={styles.meta}>
          <span class={styles.fileName}>{props.name}</span>
          <span class={styles.metaLine}>
            {typeLabel(props.mimeType)} · {formatFileSize(props.size)}
          </span>
        </div>
        <div class={styles.actions}>
          <Show when={props.preview}>
            <button class={styles.viewBtn} onClick={() => setOpen(true)}>
              View
            </button>
          </Show>
          <Show when={props.onDownload}>
            <button class={styles.downloadBtn} onClick={() => props.onDownload?.()}>
              Download
            </button>
          </Show>
        </div>
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
