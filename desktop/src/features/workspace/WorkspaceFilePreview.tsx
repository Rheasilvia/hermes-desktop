import type { Component } from 'solid-js';
import { Show, createResource, createSignal } from 'solid-js';
import { Portal } from 'solid-js/web';
import type { WorkspaceFileResult, WorkspaceTreeNode } from '@/types/index.js';
import { getGateway } from '@/stores/context.js';
import { Modal } from '@/ui/molecules/Modal.js';
import { LoadingSpinner } from '@/ui/atoms/LoadingSpinner.js';
import { FileContentView } from '@/ui/molecules/FileContentView.js';
import styles from './WorkspaceFilePreview.module.css';

interface Props {
  node: WorkspaceTreeNode;
  workspaceRoot: string;
  sessionId: string;
  onClose: () => void;
}

function formatKB(bytes: number): string {
  return (bytes / 1024).toFixed(0);
}

export const WorkspaceFilePreview: Component<Props> = (props) => {
  const [fileResult, { mutate }] = createResource<WorkspaceFileResult>(() =>
    getGateway()?.workspace.readFile(props.sessionId, props.node.path)
      ?? Promise.reject(new Error('Gateway is not initialized'))
  );
  const [editing, setEditing] = createSignal(false);
  const [draft, setDraft] = createSignal('');
  const [saving, setSaving] = createSignal(false);
  const [saveError, setSaveError] = createSignal<string | null>(null);

  const startEditing = (result: WorkspaceFileResult) => {
    if (result.binary || result.truncated || result.content == null) return;
    setDraft(result.content);
    setSaveError(null);
    setEditing(true);
  };

  const cancelEditing = () => {
    setEditing(false);
    setSaveError(null);
  };

  const saveDraft = async (result: WorkspaceFileResult) => {
    const gateway = getGateway();
    if (!gateway) {
      setSaveError('Gateway is not initialized');
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const updated = await gateway.workspace.writeFile(props.sessionId, {
        path: props.node.path,
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

  return (
    <Portal mount={document.body}>
      <Modal
        open
        title={props.node.name}
        onClose={props.onClose}
        style={{ 'max-width': '800px', width: '90vw' }}
      >
        <div class={styles.body}>
          <Show when={fileResult.loading}>
            <div class={styles.center}>
              <LoadingSpinner size="md" />
            </div>
          </Show>
          <Show when={fileResult.error}>
            <div class={styles.errorMsg}>
              Failed to read file: {String(fileResult.error)}
            </div>
          </Show>
          <Show when={fileResult() && !fileResult.loading}>
            {(_result) => {
              const result = fileResult()!;
              return (
                <>
                  <div class={styles.toolbar}>
                    <Show when={!editing() && !result.binary && !result.truncated && result.content !== null}>
                      <button
                        type="button"
                        class={styles.actionButton}
                        onClick={() => startEditing(result)}
                      >
                        Edit
                      </button>
                    </Show>
                    <Show when={editing()}>
                      <button
                        type="button"
                        class={styles.primaryButton}
                        disabled={saving()}
                        onClick={() => void saveDraft(result)}
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        class={styles.actionButton}
                        disabled={saving()}
                        onClick={cancelEditing}
                      >
                        Cancel
                      </button>
                    </Show>
                  </div>
                  <Show when={saveError()}>
                    <div class={styles.errorMsg}>{saveError()}</div>
                  </Show>
                  <Show
                    when={editing()}
                    fallback={
                      <FileContentView
                        content={result.content}
                        filename={props.node.name}
                        binary={result.binary}
                        banner={
                          result.truncated
                            ? `Showing first 100 KB of ${formatKB(result.size)} KB file`
                            : undefined
                        }
                      />
                    }
                  >
                    <textarea
                      class={styles.editor}
                      value={draft()}
                      onInput={(event) => setDraft(event.currentTarget.value)}
                      spellCheck={false}
                    />
                  </Show>
                </>
              );
            }}
          </Show>
        </div>
      </Modal>
    </Portal>
  );
};
