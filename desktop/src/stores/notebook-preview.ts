import { createSignal } from 'solid-js';
import type { NotebookCell, NotebookChangedPayload } from '@/services/gateway/types.js';
import { getGateway } from './context.js';

export interface NotebookPreviewState {
  path: string | null;
  cells: NotebookCell[];
  mtime: number;
  loading: boolean;
  error: string | null;
}

const emptyState = (): NotebookPreviewState => ({
  path: null,
  cells: [],
  mtime: 0,
  loading: false,
  error: null,
});

// Per-session notebook preview state. Solid signals keyed by sessionId.
const states = new Map<string, ReturnType<typeof createNotebookSignal>>();
// Monotonic request id per session so a slow in-flight render can't overwrite
// the state set by a newer load() (stale-response race on rapid path switch).
const loadSeq = new Map<string, number>();

function createNotebookSignal() {
  return createSignal<NotebookPreviewState>(emptyState());
}

function ensureSignal(sessionId: string) {
  let entry = states.get(sessionId);
  if (!entry) {
    entry = createNotebookSignal();
    states.set(sessionId, entry);
  }
  return entry;
}

function getState(sessionId: string): NotebookPreviewState {
  return ensureSignal(sessionId)[0]();
}

/**
 * Loads a notebook into the preview pane: fetches an initial render, then asks
 * the backend to watch the file for live updates (pushed via `notebook.changed`).
 */
async function load(sessionId: string, path: string): Promise<void> {
  const [state, setState] = ensureSignal(sessionId);
  const mySeq = (loadSeq.get(sessionId) ?? 0) + 1;
  loadSeq.set(sessionId, mySeq);
  const isStale = () => (loadSeq.get(sessionId) ?? 0) !== mySeq;
  setState({ ...state(), path, cells: [], mtime: 0, loading: true, error: null });
  const gw = getGateway();
  if (!gw) {
    if (!isStale()) setState((s) => ({ ...s, loading: false, error: 'Gateway unavailable' }));
    return;
  }
  try {
    const render = await gw.notebook.render(sessionId, path);
    // A newer load() superseded us (user switched notebooks while this was in
    // flight) — drop our response so the newer one wins.
    if (isStale()) return;
    setState({
      path: render.path,
      cells: render.cells,
      mtime: render.mtime,
      loading: false,
      error: null,
    });
    // Begin watching for live updates (best-effort; failures are non-fatal —
    // the user still has the static render).
    try {
      await gw.notebook.watch(sessionId, path);
    } catch {
      // Watch failure doesn't invalidate the render; surface is still useful.
    }
  } catch (err) {
    if (isStale()) return;
    const message = err instanceof Error ? err.message : String(err);
    setState((s) => ({ ...s, loading: false, error: message }));
  }
}

/** Stop watching the notebook for a session (e.g. when the preview closes). */
async function clear(sessionId: string): Promise<void> {
  const gw = getGateway();
  if (gw) {
    try {
      await gw.notebook.clearWatch(sessionId);
    } catch {
      // Best-effort teardown.
    }
  }
  const [, setState] = ensureSignal(sessionId);
  setState(emptyState());
}

/** Handle a `notebook.changed` SSE event — updates cells if path matches. */
function handleChanged(payload: NotebookChangedPayload): void {
  const [state, setState] = ensureSignal(payload.session_id);
  const current = state();
  // Only accept updates for the path the pane is currently showing. Stale
  // events (e.g. after switching notebooks) are ignored.
  if (current.path !== payload.path) return;
  setState({
    path: payload.path,
    cells: payload.cells,
    mtime: payload.mtime,
    loading: false,
    error: null,
  });
}

export const notebookPreviewStore = {
  getState,
  load,
  clear,
  handleChanged,
};
