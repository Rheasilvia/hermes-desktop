import { createMemo, createSignal } from 'solid-js';
import { invoke } from '@tauri-apps/api/core';
import type { WorkspaceChildrenResult, WorkspaceTreeNode, WorkspaceTreeRow } from '@/types/index.js';

interface DirectoryState {
  children: WorkspaceTreeNode[];
  truncated: boolean;
  totalRead: number;
}

interface WorkspaceState {
  root: string;
  directories: Map<string, DirectoryState>;
  expanded: Set<string>;
  selectedPath: string | null;
  loading: Set<string>;
  errors: Map<string, string>;
}

const [workspacePath, setWorkspacePathSignal] = createSignal<string | null>(null);
const [workspaceState, setWorkspaceState] = createSignal<WorkspaceState | null>(null);
let workspaceSeq = 0;
let loadSeq = 0;
const loadTokens = new Map<string, number>();

function makeState(root: string): WorkspaceState {
  return {
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
    root: state.root,
    directories: new Map(state.directories),
    expanded: new Set(state.expanded),
    selectedPath: state.selectedPath,
    loading: new Set(state.loading),
    errors: new Map(state.errors),
  };
}

async function setWorkspacePath(path: string | null): Promise<void> {
  if (workspacePath() === path) return;
  workspaceSeq += 1;
  loadSeq += 1;
  const seq = workspaceSeq;
  setWorkspacePathSignal(path);

  if (!path) {
    loadTokens.clear();
    setWorkspaceState(null);
    return;
  }

  try {
    const root = await invoke<string>('get_workspace_root', { path });
    if (seq !== workspaceSeq || workspacePath() !== path) return;
    setWorkspaceState(makeState(root));
    await loadChildren(root, { force: true });
  } catch (e) {
    if (seq !== workspaceSeq) return;
    setWorkspaceState(makeState(path));
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
    const result = await invoke<WorkspaceChildrenResult>('list_workspace_children', {
      root: state.root,
      path,
    });
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
  state: workspaceState,
  rows,
  setWorkspacePath,
  loadChildren,
  toggleExpanded,
  selectPath,
};
