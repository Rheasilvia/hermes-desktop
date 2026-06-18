import type { Component } from 'solid-js';
import { Icon } from '@/ui/atoms/Icon.js';
import styles from './ChatToolbar.module.css';

interface ChatToolbarProps {
  workspacePath: string | null;
  sessionTitle?: string;
  sidePanelActive: boolean;
  onToggleSidePanel: () => void;
  modelSelectorSlot?: any;
}

export const ChatToolbar: Component<ChatToolbarProps> = (props) => {
  return (
    <div class={styles.toolbar}>
      <div class={styles.toolbarLeft}>
        <span class={styles.sessionTitle}>{props.sessionTitle ?? 'New Conversation'}</span>
      </div>
      <div class={styles.toolbarRight}>
        {props.modelSelectorSlot}
        <button
          type="button"
          class={`${styles.iconBtn} ${props.sidePanelActive ? styles.iconBtnActive : ''}`}
          onClick={props.onToggleSidePanel}
          title={props.sidePanelActive ? 'Hide tools dock' : 'Show tools dock'}
          aria-label={props.sidePanelActive ? 'Hide tools dock' : 'Show tools dock'}
        >
          <Icon name="panel-right" size={16} />
        </button>
      </div>
    </div>
  );
};
