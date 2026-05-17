import type { Component } from 'solid-js';
import { Icon } from '@/ui/atoms/Icon.js';
import { MoreMenu } from './MoreMenu.js';
import styles from './ChatToolbar.module.css';

interface ChatToolbarProps {
  workspacePath: string | null;
  splitScreenActive: boolean;
  onToggleSplitScreen: () => void;
  modelSelectorSlot?: any;
}

export const ChatToolbar: Component<ChatToolbarProps> = (props) => {
  return (
    <div class={styles.toolbar}>
      <div class={styles.toolbarLeft}>
        {props.workspacePath && (
          <span class={styles.workspacePath} title={props.workspacePath}>
            {props.workspacePath}
          </span>
        )}
      </div>
      <div class={styles.toolbarRight}>
        {props.modelSelectorSlot}
        <button
          type="button"
          class={`${styles.iconBtn} ${props.splitScreenActive ? styles.iconBtnActive : ''}`}
          onClick={props.onToggleSplitScreen}
          title={props.splitScreenActive ? 'Hide diff' : 'Show diff'}
        >
          <Icon name="git-branch" size={16} />
        </button>
        <MoreMenu diffOpen={props.splitScreenActive} onToggleDiff={props.onToggleSplitScreen} />
      </div>
    </div>
  );
};