import type { Component } from 'solid-js';
import { For, Show, createEffect, createMemo, createSignal } from 'solid-js';
import type { WorkspaceTreeRow } from '@/types/index.js';
import { workspaceTreeStore } from '@/stores/workspace-tree.js';
import { Icon } from '@/ui/atoms/Icon.js';
import styles from './WorkspaceTreeView.module.css';

interface WorkspaceTreeViewProps {
  workspacePath: string | null;
}

export const WorkspaceTreeView: Component<WorkspaceTreeViewProps> = (props) => {
  const [focusedIndex, setFocusedIndex] = createSignal(0);
  const rows = createMemo(() => workspaceTreeStore.rows());
  const state = createMemo(() => workspaceTreeStore.state());

  createEffect(() => {
    void props.workspacePath;
    setFocusedIndex(0);
  });

  const focusRow = (index: number) => {
    const list = rows();
    if (list.length === 0) return;
    const next = Math.max(0, Math.min(index, list.length - 1));
    setFocusedIndex(next);
    workspaceTreeStore.selectPath(list[next].node.path);
  };

  const focusedRow = () => rows()[focusedIndex()] ?? null;

  const onKeyDown = (event: KeyboardEvent) => {
    const row = focusedRow();
    if (!row) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      focusRow(focusedIndex() + 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      focusRow(focusedIndex() - 1);
    } else if (event.key === 'ArrowRight') {
      if (row.node.kind === 'directory' && !state()?.expanded.has(row.node.path)) {
        event.preventDefault();
        void workspaceTreeStore.toggleExpanded(row.node.path);
      }
    } else if (event.key === 'ArrowLeft') {
      if (row.node.kind === 'directory' && state()?.expanded.has(row.node.path)) {
        event.preventDefault();
        void workspaceTreeStore.toggleExpanded(row.node.path);
      }
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (row.node.kind === 'directory') void workspaceTreeStore.toggleExpanded(row.node.path);
      else workspaceTreeStore.selectPath(row.node.path);
    }
  };

  const copyPath = async (path: string) => {
    await navigator.clipboard?.writeText(path).catch(() => undefined);
  };

  const rootError = () => {
    const current = state();
    if (!current) return null;
    return current.errors.get(current.root) ?? null;
  };

  return (
    <div class={styles.treeShell}>
      <div class={styles.treeHeader}>
        <Icon name="folder-open" size={14} />
        <span class={styles.rootPath} title={props.workspacePath ?? undefined}>{props.workspacePath ?? 'No workspace selected'}</span>
      </div>
      <Show
        when={props.workspacePath}
        fallback={<div class={styles.emptyState}>Select a workspace in the chat input to browse files.</div>}
      >
        <div
          class={styles.treeBody}
          role="tree"
          aria-label="Workspace files"
          tabIndex={0}
          onKeyDown={onKeyDown}
        >
          <Show when={rootError()}>
            <div class={styles.errorState} role="status">{rootError()}</div>
          </Show>
          <Show when={rows().length > 0 && !rootError()} fallback={<Show when={!rootError()}><div class={styles.metaRow} role="status">Loading workspace...</div></Show>}>
            <For each={rows()}>
              {(row: WorkspaceTreeRow, index) => {
                const isDirectory = () => row.node.kind === 'directory';
                const expanded = () => Boolean(isDirectory() && state()?.expanded.has(row.node.path));
                const selected = () => state()?.selectedPath === row.node.path;
                const loading = () => Boolean(state()?.loading.has(row.node.path));
                const error = () => state()?.errors.get(row.node.path);
                const dir = () => state()?.directories.get(row.node.path);

                return (
                  <>
                    <button
                      type="button"
                      role="treeitem"
                      aria-level={row.depth + 1}
                      aria-selected={selected()}
                      aria-expanded={isDirectory() ? expanded() : undefined}
                      class={styles.row}
                      classList={{
                        [styles.rowSelected]: selected(),
                        [styles.rowFocused]: focusedIndex() === index(),
                      }}
                      style={{ 'padding-left': `${8 + row.depth * 16}px` }}
                      onClick={() => {
                        setFocusedIndex(index());
                        workspaceTreeStore.selectPath(row.node.path);
                        if (row.node.kind === 'directory') void workspaceTreeStore.toggleExpanded(row.node.path);
                      }}
                      onDblClick={() => copyPath(row.node.path)}
                      title={row.node.path}
                    >
                      <span class={isDirectory() ? styles.chevron : styles.chevronPlaceholder} aria-hidden="true">
                        <Show when={isDirectory()}>{expanded() ? <Icon name="chevron-down" size={14} /> : <Icon name="chevron-right" size={14} />}</Show>
                      </span>
                      <Icon name={isDirectory() ? 'folder' : 'file'} size={14} class={isDirectory() ? styles.folderIcon : styles.fileIcon} />
                      <span class={styles.name}>{row.node.name}</span>
                    </button>
                    <Show when={loading()}>
                      <div class={styles.inlineMeta} role="status" style={{ 'padding-left': `${40 + row.depth * 16}px` }}>Loading...</div>
                    </Show>
                    <Show when={error()}>
                      <div class={styles.inlineMeta} role="status" style={{ 'padding-left': `${40 + row.depth * 16}px` }}>{error()}</div>
                    </Show>
                    <Show when={dir()?.truncated}>
                      <div class={styles.inlineMeta} role="status" style={{ 'padding-left': `${40 + (row.depth + 1) * 16}px` }}>Directory truncated after 1000 visible entries.</div>
                    </Show>
                  </>
                );
              }}
            </For>
          </Show>
        </div>
      </Show>
    </div>
  );
};
