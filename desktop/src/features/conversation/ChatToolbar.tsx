import type { Component } from 'solid-js';
import { Icon } from '@/ui/atoms/Icon.js';
import { MoreMenu } from './MoreMenu.js';
import styles from './ChatToolbar.module.css';

interface ChatToolbarProps {
  workspacePath: string | null;
  sessionTitle?: string;
  sidePanelActive: boolean;
  onToggleSidePanel: () => void;
  onOpenGitView: () => void;
  onToggleDelegationPanel: () => void;
  delegationPanelActive: boolean;
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
          title={props.sidePanelActive ? 'Hide workspace panel' : 'Show workspace panel'}
          aria-label={props.sidePanelActive ? 'Hide workspace panel' : 'Show workspace panel'}
        >
          <Icon name="panel-right" size={16} />
        </button>
        <button
          type="button"
          class={`${styles.iconBtn} ${props.delegationPanelActive ? styles.iconBtnActive : ''}`}
          onClick={props.onToggleDelegationPanel}
          title={props.delegationPanelActive ? 'Hide delegation panel' : 'Show delegation panel'}
          aria-label={props.delegationPanelActive ? 'Hide delegation panel' : 'Show delegation panel'}
        >
          <Icon name="users" size={16} />
        </button>
        <MoreMenu panelOpen={props.sidePanelActive} onOpenGitView={props.onOpenGitView} />
      </div>
    </div>
  );
};
