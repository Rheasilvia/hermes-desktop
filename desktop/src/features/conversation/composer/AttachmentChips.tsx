import type { Component } from 'solid-js';
import { For } from 'solid-js';
import { Icon } from '@/ui/atoms/Icon.js';
import styles from '../MessageInput.module.css';

export type AttachmentKind = 'file' | 'folder' | 'image' | 'url' | 'terminal';

export interface AttachmentChip {
  id: string;
  kind: AttachmentKind;
  name: string;
  size?: number;
  path?: string;
  refText?: string;
}

interface AttachmentChipsProps {
  attachments: AttachmentChip[];
  onRemove: (id: string) => void;
}

const iconForKind = (kind: AttachmentKind) => {
  switch (kind) {
    case 'folder': return 'folder';
    case 'image': return 'image';
    case 'url': return 'globe';
    case 'terminal': return 'terminal';
    case 'file':
    default: return 'file-code';
  }
};

export const AttachmentChips: Component<AttachmentChipsProps> = (props) => (
  <div class={styles.chipsRow}>
    <For each={props.attachments}>
      {(chip) => (
        <div class={styles.attachmentChip}>
          <Icon name={iconForKind(chip.kind)} size={12} class={styles.chipIcon} />
          <span class={styles.chipName}>{chip.name}</span>
          <button
            class={styles.chipRemove}
            type="button"
            onClick={() => props.onRemove(chip.id)}
            aria-label={`Remove ${chip.name}`}
          >
            <Icon name="x" size={10} />
          </button>
        </div>
      )}
    </For>
  </div>
);
