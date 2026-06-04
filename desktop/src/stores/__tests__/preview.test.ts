import { beforeEach, describe, expect, it } from 'vitest';
import { previewStore, type PreviewTarget } from '../preview.js';

const htmlFile: PreviewTarget = {
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

    expect(previewStore.get('sess_1')?.normalized.renderMode).toBe('source');
  });

  it('normalizes tool-result html file previews to live preview mode', () => {
    previewStore.register('sess_1', htmlFile, 'tool-result');

    expect(previewStore.get('sess_1')?.normalized.renderMode).toBe('preview');
  });

  it('keeps one independent active preview per session', () => {
    previewStore.register('sess_1', htmlFile, 'manual');
    previewStore.register('sess_2', { ...htmlFile, label: 'app.html', url: 'file:///tmp/app.html' }, 'tool-result');

    expect(previewStore.get('sess_1')?.normalized.url).toBe('file:///tmp/index.html');
    expect(previewStore.get('sess_2')?.normalized.url).toBe('file:///tmp/app.html');
  });

  it('dismisses only the requested session preview', () => {
    previewStore.register('sess_1', htmlFile, 'manual');
    previewStore.register('sess_2', { ...htmlFile, url: 'file:///tmp/app.html' }, 'manual');

    previewStore.dismiss('sess_1');

    expect(previewStore.get('sess_1')).toBeNull();
    expect(previewStore.get('sess_2')).not.toBeNull();
  });
});
