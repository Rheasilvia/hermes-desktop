/**
 * Right-pane file editor for the Memory Manager.
 *
 * Two modes: Preview (markdown rendered via parseMarkdown) and Edit
 * (textarea). Save button appears only when the draft differs from the
 * server copy. On 409 conflict the store surfaces a `conflict` snapshot
 * which this component renders as an inline banner with two buttons:
 * keep mine, or adopt server.
 */
import { Component, Show, createSignal, createMemo } from 'solid-js';

import { memoryStore } from '@/stores/memory.js';
import { parseMarkdown } from '@/utils/markdown.js';
import { Icon } from '@/ui/atoms/Icon.js';
import { LoadingSpinner } from '@/ui/atoms/LoadingSpinner.js';
import { EmptyState } from '@/ui/molecules/EmptyState.js';
import styles from './MemoryFileEditor.module.css';

export const MemoryFileEditor: Component = () => {
  const [mode, setMode] = createSignal<'preview' | 'edit'>('preview');

  const sel = memoryStore.selection;
  const file = memoryStore.selectedFile;
  const draft = memoryStore.draftContent;
  const dirty = memoryStore.dirty;
  const saving = memoryStore.saving;
  const loading = memoryStore.loadingFile;
  const conflict = memoryStore.conflict;

  const headerPath = createMemo(() => {
    const f = file();
    if (f) return f.abs_path;
    const s = sel();
    if (!s) return '';
    return s.workspace ? `${s.workspace}/${s.name}` : s.name;
  });

  const headerName = createMemo(() => sel()?.name ?? '');

  const html = createMemo(() => parseMarkdown(draft() || ''));

  const onSave = () => {
    void memoryStore.saveDraft();
  };

  return (
    <div class={styles.editor}>
      <Show
        when={sel()}
        fallback={
          <div class={styles.placeholder}>
            <EmptyState
              iconName="brain"
              title="Select a file"
              description="Pick a memory file from the tree to preview or edit."
            />
          </div>
        }
      >
        <header class={styles.header}>
          <div class={styles.headerInfo}>
            <Icon name="file-text" size={14} strokeWidth={1.5} />
            <span class={styles.headerName}>{headerName()}</span>
            <span class={styles.headerPath} title={headerPath()}>
              {headerPath()}
            </span>
          </div>
          <div class={styles.headerActions}>
            <div class={styles.modeToggle} role="tablist">
              <button
                type="button"
                class={mode() === 'preview' ? styles.modeActive : styles.mode}
                onClick={() => setMode('preview')}
                role="tab"
                aria-selected={mode() === 'preview'}
              >
                Preview
              </button>
              <button
                type="button"
                class={mode() === 'edit' ? styles.modeActive : styles.mode}
                onClick={() => setMode('edit')}
                role="tab"
                aria-selected={mode() === 'edit'}
              >
                Edit
              </button>
            </div>
            <button
              type="button"
              class={styles.saveBtn}
              onClick={onSave}
              disabled={!dirty() || saving()}
              aria-label="Save"
            >
              <Show when={!saving()} fallback={<LoadingSpinner size="sm" />}>
                Save
              </Show>
            </button>
          </div>
        </header>

        <Show when={conflict()}>
          {(c) => (
            <div class={styles.conflict}>
              <div class={styles.conflictText}>
                File changed on disk while you were editing.
                Choose how to resolve.
              </div>
              <div class={styles.conflictActions}>
                <button
                  type="button"
                  class={styles.conflictBtn}
                  onClick={() => memoryStore.resolveConflictAdoptServer()}
                  title="Discard your draft and load the latest server content"
                >
                  Use server (size {c().size_bytes} B)
                </button>
                <button
                  type="button"
                  class={styles.conflictBtnPrimary}
                  onClick={() => void memoryStore.resolveConflictKeepDraft()}
                >
                  Keep mine (overwrite)
                </button>
              </div>
            </div>
          )}
        </Show>

        <Show
          when={!loading()}
          fallback={
            <div class={styles.center}>
              <LoadingSpinner size="md" label="Loading file…" />
            </div>
          }
        >
          <Show
            when={mode() === 'preview'}
            fallback={
              <textarea
                class={styles.textarea}
                value={draft()}
                onInput={(e) => memoryStore.setDraft(e.currentTarget.value)}
                spellcheck={false}
                aria-label="File content"
              />
            }
          >
            <Show
              when={draft()}
              fallback={
                <div class={styles.placeholder}>
                  <EmptyState
                    iconName="file-text"
                    title={file() ? 'Empty file' : 'File does not exist yet'}
                    description="Switch to Edit mode and type to create."
                  />
                </div>
              }
            >
              <div
                class={styles.preview}
                innerHTML={html()}
              />
            </Show>
          </Show>
        </Show>
      </Show>
    </div>
  );
};
