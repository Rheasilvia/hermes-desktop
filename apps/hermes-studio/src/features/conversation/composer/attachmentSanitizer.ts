import type { AttachmentChip, AttachmentKind } from './AttachmentChips.js';

const ATTACHMENT_KINDS = new Set<AttachmentKind>(['file', 'folder', 'image', 'url', 'terminal']);

export function isAttachmentChip(value: unknown): value is AttachmentChip {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<AttachmentChip>;
  return typeof item.id === 'string' &&
    ATTACHMENT_KINDS.has(item.kind as AttachmentKind) &&
    typeof item.name === 'string';
}

export function sanitizeAttachmentChips(items: readonly unknown[] | null | undefined): AttachmentChip[] {
  return (items ?? [])
    .filter(isAttachmentChip)
    .map((item) => ({ ...item }));
}
