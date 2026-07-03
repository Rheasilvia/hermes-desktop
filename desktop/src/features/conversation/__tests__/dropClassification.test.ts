import { describe, expect, it } from 'vitest';
import { classifyDroppedEntries } from '../MessageInput.js';

/**
 * Pure classification behind the chat file-drop. Guards the folder-detection
 * regression: a dropped directory must become a @folder: ref (folderPaths),
 * not be lumped in with plain files.
 */
function file(name: string, type = ''): File {
  return new File([''], name, { type });
}

function dirItem(): DataTransferItem {
  return { webkitGetAsEntry: () => ({ isDirectory: true }) } as unknown as DataTransferItem;
}

function fileItem(): DataTransferItem {
  return { webkitGetAsEntry: () => ({ isDirectory: false }) } as unknown as DataTransferItem;
}

describe('classifyDroppedEntries', () => {
  it('routes a dropped directory to folderPaths', () => {
    const result = classifyDroppedEntries([file('project')], [dirItem()]);
    expect(result.folderPaths).toEqual(['project']);
    expect(result.filePaths).toEqual([]);
    expect(result.imagePaths).toEqual([]);
  });

  it('routes images by MIME type and other files to filePaths', () => {
    const result = classifyDroppedEntries(
      [file('a.png', 'image/png'), file('notes.txt', 'text/plain')],
      [fileItem(), fileItem()],
    );
    expect(result.imagePaths).toEqual(['a.png']);
    expect(result.filePaths).toEqual(['notes.txt']);
    expect(result.folderPaths).toEqual([]);
  });

  it('mixes folder, image, and file in a single drop', () => {
    const result = classifyDroppedEntries(
      [file('src'), file('logo.jpg', 'image/jpeg'), file('main.ts')],
      [dirItem(), fileItem(), fileItem()],
    );
    expect(result.folderPaths).toEqual(['src']);
    expect(result.imagePaths).toEqual(['logo.jpg']);
    expect(result.filePaths).toEqual(['main.ts']);
  });

  it('falls back to MIME classification when the entry API is unavailable', () => {
    // No items (older webviews) → nothing is a folder; classify by MIME only.
    const result = classifyDroppedEntries([file('a.png', 'image/png'), file('b.bin')], []);
    expect(result.folderPaths).toEqual([]);
    expect(result.imagePaths).toEqual(['a.png']);
    expect(result.filePaths).toEqual(['b.bin']);
  });

  it('skips entries with no resolvable path', () => {
    const result = classifyDroppedEntries([file('')], [fileItem()]);
    expect(result.folderPaths).toEqual([]);
    expect(result.imagePaths).toEqual([]);
    expect(result.filePaths).toEqual([]);
  });
});
