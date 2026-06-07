import type { AttachmentKind } from '@/features/conversation/composer/AttachmentChips.js';
import type { UserDisplayPart } from '@/features/conversation/display-parts.js';

export interface ComposerCommandPrefix {
  command: string;
  icon?: string;
}

export interface ComposerDraftAttachment {
  id: string;
  kind: AttachmentKind;
  name: string;
  detail?: string;
  size?: number;
  path?: string;
  refText?: string;
}

export interface ComposerDraft {
  text: string;
  commandPrefix: ComposerCommandPrefix | null;
  attachments: ComposerDraftAttachment[];
  displayParts?: UserDisplayPart[];
  cwd: string | null;
}

const drafts = new Map<string, ComposerDraft>();

function cloneDraft(draft: ComposerDraft): ComposerDraft {
  return {
    text: draft.text,
    commandPrefix: draft.commandPrefix ? { ...draft.commandPrefix } : null,
    attachments: draft.attachments.map((attachment) => ({ ...attachment })),
    displayParts: draft.displayParts?.map((part) => ({ ...part })),
    cwd: draft.cwd,
  };
}

export function getComposerDraft(sessionId: string): ComposerDraft | null {
  const draft = drafts.get(sessionId);
  return draft ? cloneDraft(draft) : null;
}

export function saveComposerDraft(sessionId: string, draft: ComposerDraft): void {
  drafts.set(sessionId, cloneDraft(draft));
}

export function clearComposerDraft(sessionId: string): void {
  drafts.delete(sessionId);
}

export function clearAllComposerDrafts(): void {
  drafts.clear();
}
