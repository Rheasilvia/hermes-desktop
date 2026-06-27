import { createSignal } from 'solid-js';
import type { BranchListResult, ProjectEntry, WorktreeListResult } from '@/types/index.js';
import { getGateway } from './context.js';

const [projects, setProjects] = createSignal<ProjectEntry[]>([]);
const [activePath, setActivePath] = createSignal<string | null>(null);
const [worktrees, setWorktrees] = createSignal<WorktreeListResult | null>(null);
const [branches, setBranches] = createSignal<BranchListResult | null>(null);
const [loading, setLoading] = createSignal(false);
const [error, setError] = createSignal<string | null>(null);
let requestSeq = 0;
let activeSeq = 0;
let worktreeSeq = 0;

async function load(): Promise<void> {
  const seq = ++requestSeq;
  setLoading(true);
  setError(null);
  try {
    const gateway = getGateway();
    if (!gateway) throw new Error('Gateway is not initialized');
    const result = await gateway.projects.list();
    if (seq !== requestSeq) return;
    setProjects(result.projects);
    setActivePath(result.active_path ?? null);
  } catch (e) {
    if (seq !== requestSeq) return;
    setError(errorMessage(e, 'Failed to load projects'));
  } finally {
    if (seq === requestSeq) setLoading(false);
  }
}

async function addProject(path: string, name?: string): Promise<void> {
  const gateway = getGateway();
  if (!gateway) return;
  setError(null);
  try {
    await gateway.projects.upsert(path, name);
    await load();
  } catch (e) {
    setError(errorMessage(e, 'Failed to add project'));
  }
}

async function setActiveProject(path: string | null): Promise<void> {
  const gateway = getGateway();
  if (!gateway) return;
  const seq = ++activeSeq;
  setError(null);
  try {
    const result = await gateway.projects.setActive(path);
    if (seq !== activeSeq) return;
    setProjects(result.projects);
    setActivePath(result.active_path ?? null);
  } catch (e) {
    if (seq !== activeSeq) return;
    setError(errorMessage(e, 'Failed to set active project'));
  }
}

async function loadWorktrees(repoPath: string): Promise<void> {
  const gateway = getGateway();
  if (!gateway) return;
  const seq = ++worktreeSeq;
  setError(null);
  setWorktrees(null);
  setBranches(null);
  try {
    const [treeResult, branchResult] = await Promise.all([
      gateway.projects.worktrees(repoPath),
      gateway.projects.branches(repoPath),
    ]);
    if (seq !== worktreeSeq) return;
    setWorktrees(treeResult);
    setBranches(branchResult);
  } catch (e) {
    if (seq !== worktreeSeq) return;
    setError(errorMessage(e, 'Failed to load worktrees'));
  }
}

function errorMessage(error: unknown, fallback: string): string {
  if (typeof error === 'string') return error;
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

export const projectStore = {
  projects,
  activePath,
  worktrees,
  branches,
  loading,
  error,
  load,
  addProject,
  setActiveProject,
  loadWorktrees,
  resetForTests() {
    requestSeq += 1;
    activeSeq += 1;
    worktreeSeq += 1;
    setProjects([]);
    setActivePath(null);
    setWorktrees(null);
    setBranches(null);
    setLoading(false);
    setError(null);
  },
};
