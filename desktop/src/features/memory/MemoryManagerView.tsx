/**
 * Top-level Memory Manager view (route: /memory).
 *
 * Layout: left rail with search + User group + Projects list (each project
 * is a header row with its existing files inline below — same flat
 * pattern as the Conversations sidebar). Right pane is the file editor or,
 * when search is active, a results list.
 *
 * Files that do not exist on disk are hidden from the tree by design —
 * the Manager only surfaces files the user has actually created.
 *
 * URL ↔ store sync: query params drive selection (`scope`, `name`,
 * `workspace`, `q`) so refresh and shareable links restore state.
 */
import {
  Component,
  Show,
  For,
  createEffect,
  onMount,
  createMemo,
} from 'solid-js';
import { useSearchParams } from '@solidjs/router';

import { memoryStore, type MemorySelection } from '@/stores/memory.js';
import type {
  MemoryFile,
  MemoryScope,
  WellKnownMemoryName,
} from '@/types/memory.js';
import { LoadingSpinner } from '@/ui/atoms/LoadingSpinner.js';
import { Icon } from '@/ui/atoms/Icon.js';
import { EmptyState } from '@/ui/molecules/EmptyState.js';
import { MemoryFileTree } from './MemoryFileTree.js';
import { MemoryFileEditor } from './MemoryFileEditor.js';
import styles from './MemoryManagerView.module.css';

const VALID_SCOPES = new Set<MemoryScope>(['user', 'project']);

/** SolidJS search params can be string | string[] | undefined; flatten to a single string. */
function readParam(v: string | string[] | undefined): string | null {
  if (Array.isArray(v)) return v[0] ?? null;
  return typeof v === 'string' && v ? v : null;
}

function basename(p: string | null): string {
  if (!p) return '';
  const cleaned = p.replace(/\/+$/, '');
  const idx = cleaned.lastIndexOf('/');
  return idx >= 0 ? cleaned.slice(idx + 1) : cleaned;
}

export const MemoryManagerView: Component = () => {
  const [searchParams, setSearchParams] = useSearchParams();

  onMount(() => {
    void memoryStore.loadProjects();
    void memoryStore.loadUserFiles();
  });

  // ── URL → store ──────────────────────────────────────────────────────
  createEffect(() => {
    const scope = readParam(searchParams.scope);
    const name = readParam(searchParams.name);
    const workspace = readParam(searchParams.workspace);
    const q = readParam(searchParams.q) ?? '';

    if (q !== memoryStore.searchQuery()) {
      memoryStore.setSearchQuery(q);
    }

    if (workspace) {
      if (memoryStore.activeProject() !== workspace) {
        void memoryStore.setActiveProject(workspace);
      }
    }

    if (scope && name && VALID_SCOPES.has(scope as MemoryScope)) {
      const sel: MemorySelection = {
        scope: scope as MemoryScope,
        name: name as WellKnownMemoryName,
        workspace: workspace ?? undefined,
      };
      memoryStore.setSelection(sel);
    }
  });

  // ── store → URL ──────────────────────────────────────────────────────
  const updateUrlForSelection = (file: MemoryFile) => {
    setSearchParams(
      {
        scope: file.scope,
        name: file.well_known_name,
        workspace: file.workspace_path ?? undefined,
        q: memoryStore.searchQuery() || undefined,
      },
      { replace: false },
    );
  };

  const updateUrlForQuery = (q: string) => {
    const sel = memoryStore.selection();
    setSearchParams(
      {
        scope: sel?.scope,
        name: sel?.name,
        workspace: sel?.workspace,
        q: q || undefined,
      },
      { replace: true },
    );
  };

  const onSelectFile = (file: MemoryFile) => {
    updateUrlForSelection(file);
  };

  const onSearchInput = (e: InputEvent) => {
    const v = (e.currentTarget as HTMLInputElement).value;
    memoryStore.setSearchQuery(v);
    updateUrlForQuery(v);
  };

  const showSearchResults = () => memoryStore.searchQuery().trim().length > 0;

  const userExisting = createMemo(() =>
    memoryStore.userFiles().filter((f) => f.exists),
  );

  /** Returns existing files for a given workspace from the eagerly-loaded map. */
  const projectExistingFiles = (workspace: string): MemoryFile[] => {
    const all = memoryStore.projectFilesMap().get(workspace) ?? [];
    return all.filter((f) => f.exists);
  };

  return (
    <div class={styles.view}>
      <aside class={styles.rail}>
        <div class={styles.searchBar}>
          <Icon name="search" size={12} class={styles.searchIcon} />
          <input
            class={styles.searchInput}
            type="text"
            placeholder="Search memory…"
            value={memoryStore.searchQuery()}
            onInput={onSearchInput}
          />
          <Show when={memoryStore.searchQuery()}>
            <button
              type="button"
              class={styles.searchClear}
              onClick={() => {
                memoryStore.setSearchQuery('');
                updateUrlForQuery('');
              }}
              title="Clear search"
            >
              <Icon name="x" size={10} />
            </button>
          </Show>
        </div>

        <Show when={memoryStore.error()}>
          {(msg) => (
            <div class={styles.error} role="alert">
              <span>{msg()}</span>
              <button
                type="button"
                class={styles.errorDismiss}
                onClick={() => memoryStore.clearError()}
                aria-label="Dismiss error"
              >
                <Icon name="x" size={10} />
              </button>
            </div>
          )}
        </Show>

        <div class={styles.section}>
          <div class={styles.sectionHeader}>User</div>
          <Show
            when={userExisting().length > 0}
            fallback={
              <div class={styles.sectionEmpty}>No user memory files yet</div>
            }
          >
            <MemoryFileTree
              files={userExisting()}
              selected={memoryStore.selection()}
              onSelect={onSelectFile}
              loading={memoryStore.loadingUserFiles()}
              hideMissing
            />
          </Show>
        </div>

        <div class={styles.section}>
          <div class={styles.sectionHeader}>Projects</div>
          <Show
            when={memoryStore.projects().length > 0}
            fallback={
              <div class={styles.sectionEmpty}>
                {memoryStore.loadingProjects() ? 'Loading…' : 'No projects yet'}
              </div>
            }
          >
            <For each={memoryStore.projects()}>
              {(project) => {
                const files = () => projectExistingFiles(project.workspace_path);
                const isActive = () =>
                  memoryStore.activeProject() === project.workspace_path;
                return (
                  <div
                    class={`${styles.project} ${isActive() ? styles.projectActive : ''}`}
                  >
                    <button
                      type="button"
                      class={styles.projectRow}
                      onClick={() =>
                        void memoryStore.setActiveProject(project.workspace_path)
                      }
                      title={project.workspace_path}
                    >
                      <Icon name="folder" size={12} strokeWidth={1.5} />
                      <span class={styles.projectName}>
                        {basename(project.workspace_path)}
                      </span>
                      <Show when={files().length > 0}>
                        <span class={styles.projectCount}>
                          {files().length}
                        </span>
                      </Show>
                    </button>
                    <Show when={files().length > 0}>
                      <div class={styles.projectFiles}>
                        <MemoryFileTree
                          files={files()}
                          selected={memoryStore.selection()}
                          onSelect={onSelectFile}
                          hideMissing
                        />
                      </div>
                    </Show>
                  </div>
                );
              }}
            </For>
          </Show>
        </div>
      </aside>

      <main class={styles.main}>
        <Show
          when={!showSearchResults()}
          fallback={
            <div class={styles.results}>
              <div class={styles.resultsHeader}>
                <span>
                  {memoryStore.searchResults().length} result
                  {memoryStore.searchResults().length === 1 ? '' : 's'} for
                  &nbsp;"{memoryStore.searchQuery()}"
                </span>
                <Show when={memoryStore.loadingSearch()}>
                  <LoadingSpinner size="sm" />
                </Show>
              </div>
              <Show
                when={memoryStore.searchResults().length > 0}
                fallback={
                  <Show when={!memoryStore.loadingSearch()}>
                    <EmptyState
                      iconName="search"
                      title="No matches"
                      description="Try a different query, or clear the search to keep editing."
                    />
                  </Show>
                }
              >
                <ul class={styles.resultsList}>
                  <For each={memoryStore.searchResults()}>
                    {(hit) => (
                      <li>
                        <button
                          type="button"
                          class={styles.resultItem}
                          onClick={() => {
                            onSelectFile(hit.info);
                            memoryStore.setSearchQuery('');
                            updateUrlForQuery('');
                          }}
                        >
                          <div class={styles.resultPath}>
                            {hit.info.well_known_name}
                            <span class={styles.resultLine}>
                              :{hit.line_number}
                            </span>
                          </div>
                          <div class={styles.resultSnippet}>{hit.snippet}</div>
                        </button>
                      </li>
                    )}
                  </For>
                </ul>
              </Show>
            </div>
          }
        >
          <MemoryFileEditor />
        </Show>
      </main>
    </div>
  );
};

