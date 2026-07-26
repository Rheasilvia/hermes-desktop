/**
 * Centralized state for the Memory Manager.
 *
 * Pure SolidJS `createSignal` store (matching the existing codebase
 * convention — see `stores/cron.ts`, `stores/models.ts`). The Manager view
 * binds the URL search params (`scope`, `name`, `workspace`, `q`) to this
 * store so refresh and shareable links restore state.
 *
 * Failure mode rule: every async action either resolves with real backend
 * data or sets `error()` to a human-readable message. Hardcoded sample
 * data is forbidden — the prior `FALLBACK_*` pattern is gone for good.
 */
import { createSignal } from 'solid-js';

import { getGateway } from '@/stores/context.js';
import { isApiError } from '@/services/api/types.js';
import type {
  MemoryFile,
  MemoryFileWithContent,
  MemoryProject,
  MemorySearchHit,
  MemoryScope,
  WellKnownMemoryName,
} from '@/types/memory.js';

export interface MemorySelection {
  scope: MemoryScope;
  name: WellKnownMemoryName;
  /** Required when scope === 'project'. */
  workspace?: string;
}

// ── Signals ──────────────────────────────────────────────────────────────

const [projects, setProjects] = createSignal<MemoryProject[]>([]);
const [activeProject, setActiveProjectInternal] = createSignal<string | null>(null);
const [userFiles, setUserFiles] = createSignal<MemoryFile[]>([]);
const [projectFiles, setProjectFiles] = createSignal<MemoryFile[]>([]);
/**
 * Files for every known project, keyed by workspace_path. Used by the
 * Manager rail to show a flat list of all projects with their files
 * inline (the "conversations workspace" alignment).
 */
const [projectFilesMap, setProjectFilesMap] = createSignal<
  Map<string, MemoryFile[]>
>(new Map());
const [selection, setSelectionInternal] = createSignal<MemorySelection | null>(null);
const [selectedFile, setSelectedFile] = createSignal<MemoryFileWithContent | null>(null);
const [draftContent, setDraftContent] = createSignal<string>('');
const [dirty, setDirty] = createSignal<boolean>(false);
const [searchQuery, setSearchQueryInternal] = createSignal<string>('');
const [searchResults, setSearchResults] = createSignal<MemorySearchHit[]>([]);
const [conflict, setConflict] = createSignal<MemoryFileWithContent | null>(null);

const [loadingProjects, setLoadingProjects] = createSignal(false);
const [loadingUserFiles, setLoadingUserFiles] = createSignal(false);
const [loadingProjectFiles, setLoadingProjectFiles] = createSignal(false);
const [loadingFile, setLoadingFile] = createSignal(false);
const [loadingSearch, setLoadingSearch] = createSignal(false);
const [saving, setSaving] = createSignal(false);

const [error, setError] = createSignal<string | null>(null);

// ── Helpers ──────────────────────────────────────────────────────────────

function explain(err: unknown, fallback: string): string {
  if (isApiError(err)) {
    return err.message || err.code || fallback;
  }
  if (err instanceof Error) return err.message || fallback;
  return fallback;
}

// ── Actions ──────────────────────────────────────────────────────────────

async function loadProjects(): Promise<void> {
  const g = getGateway();
  if (!g) return;
  setLoadingProjects(true);
  try {
    const list = await g.memory.projects();
    setProjects(list);
    // Eagerly fetch files for every known project so the rail can render
    // a flat tree without per-row click-to-load latency.
    void loadAllProjectFiles(list.map((p) => p.workspace_path));
  } catch (err) {
    setError(explain(err, 'Failed to load projects'));
    setProjects([]);
  } finally {
    setLoadingProjects(false);
  }
}

async function loadAllProjectFiles(workspaces: string[]): Promise<void> {
  const g = getGateway();
  if (!g) return;
  const results = await Promise.all(
    workspaces.map(async (ws) => {
      try {
        const files = await g.memory.files('project', ws);
        return [ws, files] as const;
      } catch {
        return [ws, [] as MemoryFile[]] as const;
      }
    }),
  );
  const next = new Map<string, MemoryFile[]>();
  for (const [ws, files] of results) next.set(ws, files);
  setProjectFilesMap(next);
}

async function loadUserFiles(): Promise<void> {
  const g = getGateway();
  if (!g) return;
  setLoadingUserFiles(true);
  try {
    setUserFiles(await g.memory.files('user'));
  } catch (err) {
    setError(explain(err, 'Failed to load user files'));
    setUserFiles([]);
  } finally {
    setLoadingUserFiles(false);
  }
}

async function loadProjectFiles(workspace: string | null): Promise<void> {
  if (!workspace) {
    setProjectFiles([]);
    return;
  }
  const g = getGateway();
  if (!g) return;
  setLoadingProjectFiles(true);
  try {
    setProjectFiles(await g.memory.files('project', workspace));
  } catch (err) {
    setError(explain(err, 'Failed to load project files'));
    setProjectFiles([]);
  } finally {
    setLoadingProjectFiles(false);
  }
}

async function setActiveProject(workspace: string | null): Promise<void> {
  setActiveProjectInternal(workspace);
  await loadProjectFiles(workspace);
}

async function loadSelectedFile(): Promise<void> {
  const sel = selection();
  if (!sel) {
    setSelectedFile(null);
    setDraftContent('');
    setDirty(false);
    return;
  }
  const g = getGateway();
  if (!g) return;
  setLoadingFile(true);
  try {
    const file = await g.memory.readFile(sel.scope, sel.name, sel.workspace);
    setSelectedFile(file);
    setDraftContent(file.content);
    setDirty(false);
  } catch (err) {
    if (isApiError(err) && err.code === 'MEMORY_FILE_NOT_FOUND') {
      // Pre-create placeholder so the editor can write a fresh file.
      setSelectedFile(null);
      setDraftContent('');
      setDirty(false);
    } else {
      setError(explain(err, 'Failed to load file'));
      setSelectedFile(null);
    }
  } finally {
    setLoadingFile(false);
  }
}

function setSelection(sel: MemorySelection | null): void {
  // No-op when same selection — avoids dirty-prompt churn on URL re-sync.
  const prev = selection();
  if (
    prev &&
    sel &&
    prev.scope === sel.scope &&
    prev.name === sel.name &&
    prev.workspace === sel.workspace
  ) {
    return;
  }
  setSelectionInternal(sel);
  setConflict(null);
  void loadSelectedFile();
}

function setDraft(content: string): void {
  setDraftContent(content);
  const current = selectedFile();
  setDirty(content !== (current?.content ?? ''));
}

async function saveDraft(): Promise<void> {
  const sel = selection();
  if (!sel) return;
  const g = getGateway();
  if (!g) return;
  setSaving(true);
  setError(null);
  setConflict(null);
  try {
    const result = await g.memory.writeFile({
      scope: sel.scope,
      name: sel.name,
      workspace: sel.workspace,
      content: draftContent(),
      ifMatch: selectedFile()?.modified_at ?? undefined,
    });
    setSelectedFile(result);
    setDraftContent(result.content);
    setDirty(false);
    if (sel.scope === 'user') void loadUserFiles();
    else void loadProjectFiles(activeProject());
  } catch (err) {
    if (isApiError(err) && err.code === 'MEMORY_CONCURRENT_WRITE') {
      const current = err.extra?.current as MemoryFileWithContent | undefined;
      if (current) {
        setConflict(current);
      } else {
        setError('Conflict: file changed on disk. Reload to see latest.');
      }
    } else {
      setError(explain(err, 'Failed to save'));
    }
  } finally {
    setSaving(false);
  }
}

/**
 * Resolve a 409 conflict by keeping the local draft and overwriting the
 * server with it.
 */
async function resolveConflictKeepDraft(): Promise<void> {
  const c = conflict();
  if (!c) return;
  setSelectedFile(c);
  setConflict(null);
  await saveDraft();
}

/**
 * Resolve a 409 conflict by discarding the local draft and adopting the
 * server's current content.
 */
function resolveConflictAdoptServer(): void {
  const c = conflict();
  if (!c) return;
  setSelectedFile(c);
  setDraftContent(c.content);
  setDirty(false);
  setConflict(null);
}

let searchTimer: ReturnType<typeof setTimeout> | null = null;

function setSearchQuery(q: string): void {
  setSearchQueryInternal(q);
  if (searchTimer) clearTimeout(searchTimer);
  if (!q.trim()) {
    setSearchResults([]);
    return;
  }
  searchTimer = setTimeout(() => {
    void runSearch();
  }, 200);
}

async function runSearch(): Promise<void> {
  const q = searchQuery().trim();
  if (!q) {
    setSearchResults([]);
    return;
  }
  const g = getGateway();
  if (!g) return;
  setLoadingSearch(true);
  try {
    setSearchResults(await g.memory.search(q));
  } catch (err) {
    setError(explain(err, 'Search failed'));
    setSearchResults([]);
  } finally {
    setLoadingSearch(false);
  }
}

function clearError(): void {
  setError(null);
}

export const memoryStore = {
  // selection
  selection,
  setSelection,
  activeProject,
  setActiveProject,
  // resources
  projects,
  userFiles,
  projectFiles,
  projectFilesMap,
  selectedFile,
  // editor
  draftContent,
  setDraft,
  dirty,
  saving,
  saveDraft,
  conflict,
  resolveConflictKeepDraft,
  resolveConflictAdoptServer,
  // search
  searchQuery,
  setSearchQuery,
  searchResults,
  loadingSearch,
  // loading
  loadingProjects,
  loadingUserFiles,
  loadingProjectFiles,
  loadingFile,
  // error
  error,
  clearError,
  // load actions
  loadProjects,
  loadUserFiles,
  loadProjectFiles,
};
