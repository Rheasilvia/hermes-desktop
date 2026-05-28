import type { Component } from 'solid-js';
import { Show, createResource } from 'solid-js';
import { Portal } from 'solid-js/web';
import { invoke } from '@tauri-apps/api/core';
import type { WorkspaceTreeNode } from '@/types/index.js';
import { Modal } from '@/ui/molecules/Modal.js';
import { LoadingSpinner } from '@/ui/atoms/LoadingSpinner.js';
import { FileContentView } from '@/ui/molecules/FileContentView.js';
import styles from './WorkspaceFilePreview.module.css';

interface WorkspaceFileResult {
  content: string | null;
  truncated: boolean;
  binary: boolean;
  size: number;
}

interface Props {
  node: WorkspaceTreeNode;
  workspaceRoot: string;
  onClose: () => void;
}

function formatKB(bytes: number): string {
  return (bytes / 1024).toFixed(0);
}

export const WorkspaceFilePreview: Component<Props> = (props) => {
  const [fileResult] = createResource<WorkspaceFileResult>(() =>
    invoke('read_workspace_file', { root: props.workspaceRoot, path: props.node.path })
  );

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
              );
            }}
          </Show>
        </div>
      </Modal>
    </Portal>
  );
};
