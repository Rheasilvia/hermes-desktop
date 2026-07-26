import { createMemo, createSignal } from 'solid-js';
import type { WorkspaceChildrenResult, WorkspaceTreeNode, WorkspaceTreeRow } from '@/types/index.js';
import { getGateway } from './context.js';

interface DirectoryState {
  children: WorkspaceTreeNode[];
  truncated: boolean;
  totalRead: number;
}

interface WorkspaceState {
  sessionId: string | null;
  root: string;
  directories: Map<string, DirectoryState>;
  expanded: Set<string>;
  selectedPath: string | null;
  loading: Set<string>;
  errors: Map<string, string>;
}

const [workspacePath, setWorkspacePathSignal] = createSignal<string | null>(null);
const [workspaceSessionId, setWorkspaceSessionId] = createSignal<string | null>(null);
const [workspaceState, setWorkspaceState] = createSignal<WorkspaceState | null>(null);
let workspaceSeq = 0;
let loadSeq = 0;
const loadTokens = new Map<string, number>();

function makeState(sessionId: string | null, root: string): WorkspaceState {
  return {
    sessionId,
    root,
    directories: new Map(),
    expanded: new Set([root]),
    selectedPath: null,
    loading: new Set(),
    errors: new Map(),
  };
}

function cloneState(state: WorkspaceState): WorkspaceState {
  return {
    sessionId: state.sessionId,
    root: state.root,
    directories: new Map(state.directories),
    expanded: new Set(state.expanded),
    selectedPath: state.selectedPath,
    loading: new Set(state.loading),
    errors: new Map(state.errors),
  };
}

async function setWorkspacePath(path: string | null): Promise<void> {
  await setWorkspace(null, path);
}

async function setWorkspace(sessionId: string | null, path: string | null): Promise<void> {
  if (workspaceSessionId() === sessionId && workspacePath() === path) return;
  workspaceSeq += 1;
  loadSeq += 1;
  const seq = workspaceSeq;
  setWorkspaceSessionId(sessionId);
  setWorkspacePathSignal(path);

  if (!path) {
    loadTokens.clear();
    setWorkspaceState(null);
    return;
  }

  setWorkspaceState(makeState(sessionId, path));
  if (!sessionId) {
    setWorkspaceState((current) => {
      if (!current) return current;
      const next = cloneState(current);
      next.errors.set(path, 'Session is required to load workspace');
      return next;
    });
    return;
  }

  try {
    if (seq !== workspaceSeq || workspaceSessionId() !== sessionId || workspacePath() !== path) return;
    await loadChildren(path, { force: true });
  } catch (e) {
    if (seq !== workspaceSeq) return;
    setWorkspaceState((current) => {
      if (!current) return current;
      const next = cloneState(current);
      next.errors.set(path, typeof e === 'string' ? e : (e as Error).message ?? 'Failed to load workspace');
      return next;
    });
  }
}

async function loadChildren(path: string, opts: { force?: boolean } = {}): Promise<void> {
  const state = workspaceState();
  if (!state) return;
  if (!opts.force && state.directories.has(path)) return;

  const seq = ++loadSeq;
  loadTokens.set(path, seq);
  setWorkspaceState((current) => {
    if (!current) return current;
    const next = cloneState(current);
    next.loading.add(path);
    next.errors.delete(path);
    return next;
  });

  try {
    const gateway = getGateway();
    if (!gateway) throw new Error('Gateway is not initialized');
    if (!state.sessionId) throw new Error('Session is required to load workspace');
    const result = await gateway.workspace.children(state.sessionId, path);
    if (loadTokens.get(path) !== seq) return;
    setWorkspaceState((current) => {
      if (!current || current.root !== state.root) return current;
      const next = cloneState(current);
      next.directories.set(result.path, {
        children: result.children,
        truncated: result.truncated,
        totalRead: result.total_read,
      });
      next.loading.delete(result.path);
      next.errors.delete(result.path);
      loadTokens.delete(path);
      return next;
    });
  } catch (e) {
    if (loadTokens.get(path) !== seq) return;
    setWorkspaceState((current) => {
      if (!current || current.root !== state.root) return current;
      const next = cloneState(current);
      next.loading.delete(path);
      next.errors.set(path, typeof e === 'string' ? e : (e as Error).message ?? 'Failed to load directory');
      loadTokens.delete(path);
      return next;
    });
  }
}

async function toggleExpanded(path: string): Promise<void> {
  const state = workspaceState();
  if (!state) return;
  if (state.expanded.has(path)) {
    setWorkspaceState((current) => {
      if (!current) return current;
      const next = cloneState(current);
      next.expanded.delete(path);
      return next;
    });
    return;
  }

  setWorkspaceState((current) => {
    if (!current) return current;
    const next = cloneState(current);
    next.expanded.add(path);
    return next;
  });
  await loadChildren(path);
}

function selectPath(path: string): void {
  setWorkspaceState((current) => {
    if (!current) return current;
    const next = cloneState(current);
    next.selectedPath = path;
    return next;
  });
}

const rows = createMemo<WorkspaceTreeRow[]>(() => {
  const state = workspaceState();
  if (!state) return [];

  const rootName = state.root.split(/[\\/]/).filter(Boolean).pop() ?? state.root;
  const root: WorkspaceTreeNode = {
    path: state.root,
    name: rootName,
    kind: 'directory',
    ignored: false,
    loaded: state.directories.has(state.root),
  };
  const out: WorkspaceTreeRow[] = [{ node: root, depth: 0 }];

  const visit = (dirPath: string, depth: number) => {
    if (!state.expanded.has(dirPath)) return;
    const dir = state.directories.get(dirPath);
    if (!dir) return;
    for (const child of dir.children) {
      out.push({ node: child, depth });
      if (child.kind === 'directory') visit(child.path, depth + 1);
    }
  };

  visit(state.root, 1);
  return out;
});

export const workspaceTreeStore = {
  workspacePath,
  workspaceSessionId,
  state: workspaceState,
  rows,
  setWorkspace,
  setWorkspacePath,
  loadChildren,
  toggleExpanded,
  selectPath,
};
