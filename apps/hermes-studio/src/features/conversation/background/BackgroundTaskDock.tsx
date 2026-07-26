import type { Component } from 'solid-js';
import { For } from 'solid-js';
import type { BackgroundTaskRecord } from '@/stores/background-tasks.js';
import { Icon } from '@/ui/atoms/Icon.js';
import { ActionRow, StatusBadge } from '../shared/index.js';
import styles from './BackgroundTaskDock.module.css';

interface BackgroundTaskDockProps {
  tasks: BackgroundTaskRecord[];
  onDismiss: (id: string) => void;
}

export const BackgroundTaskDock: Component<BackgroundTaskDockProps> = (props) => (
  <div class={styles.card}>
    <div class={styles.header}>
      <Icon name="clock" size={14} />
      <span>Background activity</span>
    </div>
    <div class={styles.list}>
      <For each={props.tasks}>
        {(task) => (
          <ActionRow
            icon={task.status === 'complete' ? 'check-circle' : 'info'}
            title={task.title}
            meta={new Date(task.completedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            preview={task.preview}
            trailing={
              <>
                <StatusBadge label={task.status === 'complete' ? 'Complete' : 'Notice'} tone={task.status === 'complete' ? 'success' : 'info'} />
                <button
                  type="button"
                  class={styles.dismissBtn}
                  onClick={() => props.onDismiss(task.id)}
                  aria-label={`Dismiss ${task.title}`}
                >
                  <Icon name="x" size={12} />
                </button>
              </>
            }
          />
        )}
      </For>
    </div>
  </div>
);
