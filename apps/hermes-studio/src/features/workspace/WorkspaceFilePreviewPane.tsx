import type { Component } from 'solid-js';
import { Match, Show, Switch, createEffect, createMemo, createResource, createSignal } from 'solid-js';
import type { WorkspaceFileResult, WorkspaceTreeNode } from '@/types/index.js';
import { getGateway } from '@/stores/context.js';
import { Icon } from '@/ui/atoms/Icon.js';
import { LoadingSpinner } from '@/ui/atoms/LoadingSpinner.js';
import { FileContentView } from '@/ui/molecules/FileContentView.js';
import styles from './WorkspaceFilePreviewPane.module.css';

interface WorkspaceFilePreviewPaneProps {
  node: WorkspaceTreeNode | null;
  sessionId: string | null;
  workspaceRoot: string;
  onBackToFiles?: () => void;
  onClose: () => void;
}

function formatKB(bytes: number): string {
  return (bytes / 1024).toFixed(0);
}

function displayPath(root: string, path: string): string {
  const normalized = root.endsWith('/') ? root : `${root}/`;
  return path.startsWith(normalized) ? path.slice(normalized.length) : path;
}

function canEdit(result: WorkspaceFileResult | null | undefined): result is WorkspaceFileResult {
  return Boolean(result && !result.binary && !result.truncated && result.content !== null);
}

export const WorkspaceFilePreviewPane: Component<WorkspaceFilePreviewPaneProps> = (props) => {
  const [editing, setEditing] = createSignal(false);
  const [draft, setDraft] = createSignal('');
  const [saving, setSaving] = createSignal(false);
  const [saveError, setSaveError] = createSignal<string | null>(null);

  const [fileResult, { mutate, refetch }] = createResource(
    () => {
      const node = props.node;
      const sessionId = props.sessionId;
      if (!node || !sessionId) return null;
      return { sessionId, path: node.path };
    },
    async (source): Promise<WorkspaceFileResult> => {
      const gateway = getGateway();
      if (!gateway) throw new Error('Gateway is not initialized');
      return gateway.workspace.readFile(source.sessionId, source.path);
    },
  );
  const loadedResult = createMemo(() => {
    if (fileResult.loading || fileResult.error) return null;
    return fileResult() ?? null;
  });
  const editableResult = createMemo(() => {
    const result = loadedResult();
    return canEdit(result) ? result : null;
  });

  createEffect(() => {
    props.node?.path;
    props.sessionId;
    setEditing(false);
    setDraft('');
    setSaveError(null);
  });

  const startEditing = (result: WorkspaceFileResult) => {
    if (!canEdit(result)) return;
    setDraft(result.content ?? '');
    setSaveError(null);
    setEditing(true);
  };

  const cancelEditing = () => {
    setEditing(false);
    setSaveError(null);
  };

  const saveDraft = async (result: WorkspaceFileResult) => {
    const gateway = getGateway();
    const node = props.node;
    const sessionId = props.sessionId;
    if (!gateway || !node || !sessionId) {
      setSaveError('Gateway is not initialized');
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const updated = await gateway.workspace.writeFile(sessionId, {
        path: node.path,
        content: draft(),
        expectedMtime: result.mtime,
        expectedSize: result.size,
      });
      mutate(updated);
      setEditing(false);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Failed to save file');
    } finally {
      setSaving(false);
    }
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || !editing()) return;
    event.preventDefault();
    event.stopPropagation();
    cancelEditing();
  };

  return (
    <section
      class={styles.pane}
      aria-label="File preview"
      onKeyDown={handleKeyDown}
    >
      <Show
        when={props.node}
        fallback={
          <div class={styles.emptyState} role="status" aria-label="No file preview selected">
            <span class={styles.emptyIcon}>
              <Icon name="file-text" size={24} />
            </span>
            <div class={styles.emptyTitle}>Select a file to preview</div>
          </div>
        }
      >
        {(node) => (
          <>
            <div class={styles.header}>
              <button
                type="button"
                class={styles.backButton}
                onClick={() => props.onBackToFiles?.()}
              >
                <Icon name="chevron-left" size={14} />
                <span>Back to files</span>
              </button>
              <span class={styles.fileIcon}>
                <Icon name="file-text" size={14} />
              </span>
              <span class={styles.titleWrap}>
                <span class={styles.title} title={node().name}>{node().name}</span>
                <span class={styles.path} title={node().path}>{displayPath(props.workspaceRoot, node().path)}</span>
              </span>
              <span class={styles.actions}>
                <Switch>
                  <Match when={editing()}>
                    <button
                      type="button"
                      class={styles.primaryButton}
                      disabled={saving() || !loadedResult()}
                      onClick={() => loadedResult() && void saveDraft(loadedResult()!)}
                    >
                      {saving() ? 'Saving...' : 'Save'}
                    </button>
                    <button
                      type="button"
                      class={styles.actionButton}
                      disabled={saving()}
                      onClick={cancelEditing}
                    >
                      Cancel
                    </button>
                  </Match>
                  <Match when={!editing()}>
                    <Show when={editableResult()}>
                      {(result) => (
                        <button
                          type="button"
                          class={styles.actionButton}
                          onClick={() => startEditing(result())}
                        >
                          Edit
                        </button>
                      )}
                    </Show>
                    <Show when={fileResult.error}>
                      <button
                        type="button"
                        class={styles.actionButton}
                        onClick={() => void refetch()}
                      >
                        Retry
                      </button>
                    </Show>
                  </Match>
                </Switch>
                <button
                  type="button"
                  class={styles.iconButton}
                  aria-label="Close file preview"
                  title="Close file preview"
                  onClick={props.onClose}
                >
                  <Icon name="x" size={14} />
                </button>
              </span>
            </div>
            <div class={styles.body}>
              <Show when={fileResult.loading}>
                <div class={styles.center} role="status">
                  <LoadingSpinner size="md" />
                  <span>Opening {node().name}...</span>
                </div>
              </Show>
              <Show when={fileResult.error}>
                <div class={styles.errorState} role="alert">
                  <Icon name="alert-circle" size={18} />
                  <span>Failed to read file: {String(fileResult.error)}</span>
                </div>
              </Show>
              <Show when={loadedResult()}>
                {(result) => (
                  <>
                    <Show when={saveError()}>
                      <div class={styles.saveError} role="alert">{saveError()}</div>
                    </Show>
                    <Show
                      when={editing()}
                      fallback={
                        <FileContentView
                          content={result().content}
                          filename={node().name}
                          binary={result().binary}
                          variant="dock"
                          banner={
                            result().truncated
                              ? `Showing first 100 KB of ${formatKB(result().size)} KB file`
                              : undefined
                          }
                        />
                      }
                    >
                      <textarea
                        class={styles.editor}
                        value={draft()}
                        onInput={(event) => setDraft(event.currentTarget.value)}
                        spellcheck={false}
                      />
                    </Show>
                  </>
                )}
              </Show>
            </div>
          </>
        )}
      </Show>
    </section>
  );
};
