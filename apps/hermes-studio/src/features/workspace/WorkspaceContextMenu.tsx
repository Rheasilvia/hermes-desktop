import type { Component } from 'solid-js';
import { Show, onCleanup, onMount } from 'solid-js';
import { Portal } from 'solid-js/web';
import type { WorkspaceTreeNode } from '@/types/index.js';
import { getGateway } from '@/stores/context.js';
import { Icon } from '@/ui/atoms/Icon.js';
import { fileChipQueue } from '@/stores/file-chip-queue.js';
import styles from './WorkspaceContextMenu.module.css';

interface Props {
  node: WorkspaceTreeNode;
  workspaceRoot: string;
  sessionId: string;
  position: { x: number; y: number };
  onClose: () => void;
  onPreview?: () => void;
}

function relativePath(root: string, path: string): string {
  const normalized = root.endsWith('/') ? root : root + '/';
  return path.startsWith(normalized) ? path.slice(normalized.length) : path;
}

function clampPosition(x: number, y: number): { x: number; y: number } {
  const menuWidth = 200;
  const menuHeight = 180;
  return {
    x: x + menuWidth > window.innerWidth ? window.innerWidth - menuWidth - 8 : x,
    y: y + menuHeight > window.innerHeight ? window.innerHeight - menuHeight - 8 : y,
  };
}

export const WorkspaceContextMenu: Component<Props> = (props) => {
  const pos = () => clampPosition(props.position.x, props.position.y);

  const handleClickOutside = (e: MouseEvent) => {
    if (!(e.target as HTMLElement).closest('[data-workspace-context-menu]')) {
      props.onClose();
    }
  };

  const handleEscape = (e: KeyboardEvent) => {
    if (e.key === 'Escape') props.onClose();
  };

  onMount(() => {
    document.addEventListener('click', handleClickOutside, true);
    document.addEventListener('keydown', handleEscape);
  });

  onCleanup(() => {
    document.removeEventListener('click', handleClickOutside, true);
    document.removeEventListener('keydown', handleEscape);
  });

  const copyToClipboard = async (text: string) => {
    await navigator.clipboard?.writeText(text).catch(() => undefined);
    props.onClose();
  };

  return (
    <Portal mount={document.body}>
      <div
        data-workspace-context-menu
        class={styles.menu}
        style={{ left: `${pos().x}px`, top: `${pos().y}px` }}
      >
        <Show when={props.node.kind === 'file'}>
          <button type="button" class={styles.item} onClick={() => { props.onPreview?.(); props.onClose(); }}>
            <Icon name="eye" size={13} />
            <span>Preview File</span>
          </button>
          <div class={styles.divider} />
        </Show>
        <button type="button" class={styles.item} onClick={() => copyToClipboard(props.node.path)}>
          <Icon name="copy" size={13} />
          <span>Copy Absolute Path</span>
        </button>
        <button type="button" class={styles.item} onClick={() => copyToClipboard(relativePath(props.workspaceRoot, props.node.path))}>
          <Icon name="external-link" size={13} />
          <span>Copy Relative Path</span>
        </button>
        <button type="button" class={styles.item} onClick={() => copyToClipboard(props.node.name)}>
          <Icon name="file" size={13} />
          <span>Copy Filename</span>
        </button>
        <div class={styles.divider} />
        <button type="button" class={styles.item} onClick={() => { fileChipQueue.enqueue({ name: props.node.name, path: props.node.path }); props.onClose(); }}>
          <Icon name="message-square" size={13} />
          <span>Insert Path in Chat</span>
        </button>
        <button
          type="button"
          class={styles.item}
          onClick={() => {
            void getGateway()?.workspace.reveal(props.sessionId, props.node.path);
            props.onClose();
          }}
        >
          <Icon name="folder-open" size={13} />
          <span>Reveal in Finder</span>
        </button>
      </div>
    </Portal>
  );
};
