import { createSignal } from 'solid-js';
import type { AttachmentChip } from '@/features/conversation/composer/AttachmentChips.js';

export interface ComposerInsertion {
  id: number;
  sessionId: string | null;
  text: string;
  attachments?: AttachmentChip[];
}

const [insertion, setInsertion] = createSignal<ComposerInsertion | null>(null);
let nextId = 1;

export const composerInsertionStore = {
  latest: insertion,
  insert(sessionId: string | null | undefined, text: string, attachments: AttachmentChip[] = []): void {
    const trimmed = text.trim();
    if (!trimmed && attachments.length === 0) return;
    setInsertion({
      id: nextId,
      sessionId: sessionId?.trim() || null,
      text: trimmed,
      attachments: attachments.map((attachment) => ({ ...attachment })),
    });
    nextId += 1;
  },
};
