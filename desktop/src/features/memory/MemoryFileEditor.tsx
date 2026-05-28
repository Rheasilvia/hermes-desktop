/**
 * Right-pane file editor for the Memory Manager.
 *
 * Two modes: Read (rendered markdown via the shared FileContentView) and
 * Edit (textarea — also the canonical source view). On 409 conflict the store
 * surfaces a `conflict` snapshot which renders as an inline banner with two
 * buttons: keep mine, or adopt server.
 */
import { Component, Show, createMemo, createSignal } from 'solid-js';

import { memoryStore } from '@/stores/memory.js';
import { Icon } from '@/ui/atoms/Icon.js';
import { LoadingSpinner } from '@/ui/atoms/LoadingSpinner.js';
import { EmptyState } from '@/ui/molecules/EmptyState.js';
import { FileContentView } from '@/ui/molecules/FileContentView.js';
import { SegmentedControl } from '@/ui/molecules/SegmentedControl.js';
import type { Segment } from '@/ui/molecules/SegmentedControl.js';
import styles from './MemoryFileEditor.module.css';

type EditorMode = 'read' | 'edit';

const MODE_SEGMENTS: Segment<EditorMode>[] = [
  { id: 'read', label: 'Read', iconName: 'eye' },
  { id: 'edit', label: 'Edit', iconName: 'pencil' },
];

export const MemoryFileEditor: Component = () => {
  const [mode, setMode] = createSignal<EditorMode>('read');

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

  const onSave = () => {
    void memoryStore.saveDraft();
  };

  const canSave = () => mode() === 'edit' && dirty() && !saving();

  return (
    <div class={styles.editor}>
      <Show
        when={sel()}
        fallback={
          <div class={styles.placeholder}>
            <EmptyState
              iconName="brain"
              title="Select a file"
              description="Pick a memory file from the tree to read or edit."
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
            <SegmentedControl
              segments={MODE_SEGMENTS}
              value={mode()}
              onChange={setMode}
              size="md"
              ariaLabel="Editor mode"
            />
            <button
              type="button"
              class={styles.saveBtn}
              onClick={onSave}
              disabled={!canSave()}
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
            when={mode() === 'read'}
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
              <FileContentView
                content={draft()}
                filename={sel()?.name}
                showSourceToggle={false}
              />
            </Show>
          </Show>
        </Show>
      </Show>
    </div>
  );
};
