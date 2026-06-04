import type { Component } from 'solid-js';
import { For } from 'solid-js';
import { Icon } from '@/ui/atoms/Icon.js';
import styles from '../MessageInput.module.css';

export interface AttachmentChip {
  name: string;
  size: number;
  path: string;
}

interface AttachmentChipsProps {
  attachments: AttachmentChip[];
  onRemove: (index: number) => void;
}

export const AttachmentChips: Component<AttachmentChipsProps> = (props) => (
  <div class={styles.chipsRow}>
    <For each={props.attachments}>
      {(chip, idx) => (
        <div class={styles.attachmentChip}>
          <Icon name="file-code" size={12} class={styles.chipIcon} />
          <span class={styles.chipName}>{chip.name}</span>
          <button
            class={styles.chipRemove}
            type="button"
            onClick={() => props.onRemove(idx())}
            aria-label={`Remove ${chip.name}`}
          >
            <Icon name="x" size={10} />
          </button>
        </div>
      )}
    </For>
  </div>
);
