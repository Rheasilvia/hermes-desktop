import { describe, expect, it } from 'vitest';
import { sanitizeAttachmentChips } from '../composer/attachmentSanitizer.js';

describe('sanitizeAttachmentChips', () => {
  it('drops attachment holes and malformed entries while cloning valid chips', () => {
    const valid = { id: 'file:/repo/a.ts', kind: 'file' as const, name: 'a.ts', path: '/repo/a.ts' };
    const result = sanitizeAttachmentChips([
      undefined,
      null,
      { id: 'missing-name', kind: 'file' },
      { id: 'bad-kind', kind: 'unknown', name: 'bad' },
      valid,
    ]);

    expect(result).toEqual([valid]);
    expect(result[0]).not.toBe(valid);
  });
});
