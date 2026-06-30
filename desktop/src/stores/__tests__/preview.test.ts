import { beforeEach, describe, expect, it } from 'vitest';
import { previewStore, type FileUrlPreviewTarget } from '../preview.js';

const htmlFile: FileUrlPreviewTarget = {
  kind: 'file',
  label: 'index.html',
  source: '/tmp/index.html',
  url: 'file:///tmp/index.html',
  previewKind: 'html',
};

describe('previewStore', () => {
  beforeEach(() => {
    window.localStorage.clear();
    previewStore.clearAll();
  });

  it('normalizes manual html file previews to source mode', () => {
    previewStore.register('sess_1', htmlFile, 'manual');

    const target = previewStore.get('sess_1')?.normalized;
    expect(target?.kind).toBe('file');
    if (target?.kind !== 'file') throw new Error('expected file preview');
    expect(target.renderMode).toBe('source');
  });

  it('normalizes tool-result html file previews to live preview mode', () => {
    previewStore.register('sess_1', htmlFile, 'tool-result');

    const target = previewStore.get('sess_1')?.normalized;
    expect(target?.kind).toBe('file');
    if (target?.kind !== 'file') throw new Error('expected file preview');
    expect(target.renderMode).toBe('preview');
  });

  it('keeps one independent active preview per session', () => {
    previewStore.register('sess_1', htmlFile, 'manual');
    previewStore.register('sess_2', { ...htmlFile, label: 'app.html', url: 'file:///tmp/app.html' }, 'tool-result');

    const first = previewStore.get('sess_1')?.normalized;
    const second = previewStore.get('sess_2')?.normalized;
    expect(first?.kind).toBe('file');
    expect(second?.kind).toBe('file');
    if (first?.kind !== 'file' || second?.kind !== 'file') throw new Error('expected file previews');
    expect(first.url).toBe('file:///tmp/index.html');
    expect(second.url).toBe('file:///tmp/app.html');
  });

  it('dismisses only the requested session preview', () => {
    previewStore.register('sess_1', htmlFile, 'manual');
    previewStore.register('sess_2', { ...htmlFile, url: 'file:///tmp/app.html' }, 'manual');

    previewStore.dismiss('sess_1');

    expect(previewStore.get('sess_1')).toBeNull();
    expect(previewStore.get('sess_2')).not.toBeNull();
  });

  it('registers plan previews as references without persisted markdown content', () => {
    previewStore.registerPlan('sess_1', {
      blockId: 'plan-block-1',
      label: 'Implementation Plan',
      messageId: 42,
    });

    const record = previewStore.get('sess_1');
    expect(record?.normalized).toEqual({
      kind: 'plan',
      label: 'Implementation Plan',
      sessionId: 'sess_1',
      blockId: 'plan-block-1',
      messageId: '42',
    });
    expect(window.localStorage.getItem('hermes.tauri.sessionPreviews.v2')).not.toContain('Full plan body');
  });

  it('ignores invalid plan preview references', () => {
    previewStore.registerPlan('sess_1', {
      blockId: '   ',
      label: 'Implementation Plan',
    });

    expect(previewStore.get('sess_1')).toBeNull();
  });
});
