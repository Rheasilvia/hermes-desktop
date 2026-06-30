import { render, screen } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Stub the gateway BEFORE importing the store so notebookPreviewStore.load
// uses our mock. The store reads getGateway() at call time.
const mockNotebook = {
  render: vi.fn(),
  watch: vi.fn(),
  clearWatch: vi.fn(),
};
vi.mock('@/stores/context.js', () => ({
  getGateway: () => ({ notebook: mockNotebook }),
}));

import { notebookPreviewStore } from '@/stores/notebook-preview.js';
import { NotebookPreview } from '../NotebookPreview.js';
import { previewStore } from '@/stores/preview.js';
import type { NotebookRender } from '@/services/gateway/types.js';

const sampleRender: NotebookRender = {
  path: 'demo.ipynb',
  mtime: 1700000000,
  size: 1234,
  cells: [
    { index: 0, cell_type: 'markdown', source: '# Hello Notebook\n\nIntro text.' },
    {
      index: 1,
      cell_type: 'code',
      source: 'print(42)',
      execution_count: 1,
      outputs: [
        { output_type: 'stream', mime: 'text/plain', text: '42\n' },
        {
          output_type: 'execute_result',
          mime: 'image/png',
          image: 'data:image/png;base64,iVBORw0KGgo=',
        },
      ],
    },
  ],
};

describe('notebookPreviewStore', () => {
  beforeEach(() => {
    mockNotebook.render.mockReset();
    mockNotebook.watch.mockReset();
    mockNotebook.clearWatch.mockReset();
    mockNotebook.render.mockResolvedValue(sampleRender);
    mockNotebook.watch.mockResolvedValue({ ok: true });
    mockNotebook.clearWatch.mockResolvedValue({ ok: true });
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('loads a notebook render and starts a watch', async () => {
    await notebookPreviewStore.load('s1', 'demo.ipynb');
    expect(mockNotebook.render).toHaveBeenCalledWith('s1', 'demo.ipynb');
    expect(mockNotebook.watch).toHaveBeenCalledWith('s1', 'demo.ipynb');

    const state = notebookPreviewStore.getState('s1');
    expect(state.path).toBe('demo.ipynb');
    expect(state.cells).toHaveLength(2);
    expect(state.cells[1].outputs![1].image).toContain('data:image/png;base64,');
    expect(state.loading).toBe(false);
    expect(state.error).toBeNull();
  });

  it('handleChanged ignores events for a different path (stale update)', async () => {
    await notebookPreviewStore.load('s1', 'demo.ipynb');
    notebookPreviewStore.handleChanged({
      session_id: 's1',
      path: 'other.ipynb', // different path
      cells: [{ index: 0, cell_type: 'markdown', source: '# stale' }],
      mtime: 999,
      size: 1,
    });
    expect(notebookPreviewStore.getState('s1').cells[0].source).toContain('Hello Notebook');
  });

  it('handleChanged updates cells when the path matches', async () => {
    await notebookPreviewStore.load('s1', 'demo.ipynb');
    notebookPreviewStore.handleChanged({
      session_id: 's1',
      path: 'demo.ipynb', // matching path
      cells: [{ index: 0, cell_type: 'markdown', source: '# Updated live' }],
      mtime: 1700000099,
      size: 1,
    });
    expect(notebookPreviewStore.getState('s1').cells[0].source).toBe('# Updated live');
  });

  it('surfaces a render error and does not start a watch', async () => {
    mockNotebook.render.mockRejectedValueOnce(new Error('boom'));
    await notebookPreviewStore.load('s1', 'demo.ipynb');
    const state = notebookPreviewStore.getState('s1');
    expect(state.error).toBe('boom');
    expect(state.loading).toBe(false);
    expect(mockNotebook.watch).not.toHaveBeenCalled();
  });
});

describe('NotebookPreview component', () => {
  beforeEach(() => {
    mockNotebook.render.mockReset();
    mockNotebook.watch.mockReset();
    mockNotebook.clearWatch.mockReset();
    mockNotebook.render.mockResolvedValue(sampleRender);
    mockNotebook.watch.mockResolvedValue({ ok: true });
    mockNotebook.clearWatch.mockResolvedValue({ ok: true });
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders notebook cells (markdown + code + outputs) and no iframe/webview', async () => {
    const target = { kind: 'notebook' as const, label: 'demo.ipynb', path: 'demo.ipynb' };
    render(() => <NotebookPreview sessionId="s-render" target={target} />);

    // Markdown heading renders.
    expect(await screen.findByRole('heading', { name: 'Hello Notebook' })).toBeTruthy();
    // Code source + stream output render into the DOM (CodeBlock/output inject
    // via innerHTML, so assert against the rendered text content).
    const bodyText = document.body.textContent ?? '';
    expect(bodyText).toContain('print(42)');
    expect(bodyText).toContain('42');
    // Image output renders as an <img> with the data URL.
    const img = document.querySelector('img[src^="data:image/png;base64,"]');
    expect(img).toBeTruthy();
    // No iframe / webview — read-only render, never an embed.
    expect(document.querySelector('iframe')).toBeNull();
    expect(document.querySelector('webview')).toBeNull();
  });

  it('shows an error state when render fails', async () => {
    mockNotebook.render.mockRejectedValueOnce(new Error('cannot parse'));
    const target = { kind: 'notebook' as const, label: 'bad.ipynb', path: 'bad.ipynb' };
    render(() => <NotebookPreview sessionId="s-err" target={target} />);
    expect(await screen.findByText(/Couldn’t render notebook/i)).toBeTruthy();
    expect(screen.getByText('cannot parse')).toBeTruthy();
  });
});

describe('previewStore notebook target', () => {
  afterEach(() => {
    previewStore.clearAll();
    try {
      window.localStorage.removeItem('hermes.tauri.sessionPreviews.v2');
    } catch {
      // ignore
    }
  });

  it('registers a notebook preview target and round-trips through storage', () => {
    const record = previewStore.registerNotebook('s1', { path: 'nb/demo.ipynb', label: 'demo.ipynb' });
    expect(record).not.toBeNull();
    expect(record!.normalized.kind).toBe('notebook');

    const got = previewStore.get('s1');
    expect(got).not.toBeNull();
    expect(got!.normalized.kind).toBe('notebook');
    if (got!.normalized.kind === 'notebook') {
      expect(got!.normalized.path).toBe('nb/demo.ipynb');
    }
  });

  it('rejects records it cannot recognize (forward-compat with v2 shape)', async () => {
    // Write a bogus record directly; load should drop it.
    window.localStorage.setItem(
      'hermes.tauri.sessionPreviews.v2',
      JSON.stringify({ s1: [{ autoOpen: true, createdAt: 1, id: 'x', normalized: { kind: 'unknown' }, sessionId: 's1', source: 'notebook', target: 't' }] }),
    );
    // Re-import to trigger loadRegistry from localStorage.
    vi.resetModules();
    const fresh = await import('@/stores/preview.js');
    expect(fresh.previewStore.get('s1')).toBeNull();
  });
});
