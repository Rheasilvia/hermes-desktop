import type { AttachmentChip } from './composer/AttachmentChips.js';

export interface UserTextDisplayPart {
  type: 'text';
  text: string;
}

export interface UserFileRefDisplayPart {
  type: 'file_ref';
  refText: string;
  name: string;
  detail?: string;
  anchor: string;
  lineStart?: number;
  lineEnd?: number;
}

export type UserDisplayPart = UserTextDisplayPart | UserFileRefDisplayPart;

const FILE_REF_RE = /^@file:(?<target>.+?)(?::(?<start>\d+)(?:-(?<end>\d+))?)?$/;

export function compactDisplayParts(parts: UserDisplayPart[]): UserDisplayPart[] {
  const next: UserDisplayPart[] = [];
  for (const part of parts) {
    if (part.type === 'text') {
      if (!part.text) continue;
      const last = next[next.length - 1];
      if (last?.type === 'text') {
        next[next.length - 1] = { type: 'text', text: `${last.text}${part.text}` };
      } else {
        next.push({ ...part });
      }
    } else {
      next.push({ ...part });
    }
  }
  return next;
}

export function parseFileRefLineRange(refText: string): { lineStart?: number; lineEnd?: number } {
  const match = FILE_REF_RE.exec(refText);
  if (!match?.groups?.start) return {};
  const lineStart = Number(match.groups.start);
  const lineEnd = Number(match.groups.end ?? match.groups.start);
  return Number.isFinite(lineStart) && Number.isFinite(lineEnd) ? { lineStart, lineEnd } : {};
}

export function parseFileRefDetail(refText: string): string | undefined {
  const match = FILE_REF_RE.exec(refText);
  const rawTarget = match?.groups?.target;
  if (!rawTarget) return undefined;
  const target = rawTarget.startsWith('"') && rawTarget.endsWith('"')
    ? rawTarget.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\')
    : rawTarget;
  const start = match.groups?.start;
  if (!start) return target;
  const end = match.groups?.end;
  return `${target}:${start}${end ? `-${end}` : ''}`;
}

export function fileRefLabel(part: Pick<UserFileRefDisplayPart, 'name' | 'lineStart' | 'lineEnd'>): string {
  if (!part.lineStart) return part.name;
  if (!part.lineEnd || part.lineEnd === part.lineStart) return `${part.name}:L${part.lineStart}`;
  return `${part.name}:L${part.lineStart}-L${part.lineEnd}`;
}

export function displayPartToAttachment(part: UserFileRefDisplayPart): AttachmentChip {
  return {
    id: `file:${part.refText}`,
    kind: 'file',
    name: part.name,
    detail: part.detail,
    refText: part.refText,
    size: 0,
  };
}

export function attachmentsFromDisplayParts(parts: UserDisplayPart[]): AttachmentChip[] {
  return parts
    .filter((part): part is UserFileRefDisplayPart => part.type === 'file_ref')
    .map(displayPartToAttachment);
}

export function contextRefsFromDisplayParts(parts: UserDisplayPart[]): string {
  return parts
    .filter((part): part is UserFileRefDisplayPart => part.type === 'file_ref')
    .map((part) => part.refText)
    .join('\n');
}

export function llmMessageFromDisplayParts(parts: UserDisplayPart[]): string {
  return compactDisplayParts(parts)
    .map((part) => {
      if (part.type === 'text') return part.text;
      return `[${part.anchor}: ${fileRefLabel(part)}]`;
    })
    .join('')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

export function normalizeDisplayPartAnchors(parts: UserDisplayPart[]): UserDisplayPart[] {
  let fileIndex = 0;
  return compactDisplayParts(parts).map((part) => {
    if (part.type === 'text') return part;
    fileIndex += 1;
    return { ...part, anchor: `File ${fileIndex}` };
  });
}
