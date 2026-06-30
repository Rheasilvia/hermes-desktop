import type { Component } from 'solid-js';
import { Show, For, createSignal, createMemo } from 'solid-js';
import type { TodoItem } from '@/types/gateway.js';
import { Icon } from '@/ui/atoms/Icon.js';
import styles from './TodoPanel.module.css';

interface TodoPanelProps {
  todos: TodoItem[];
  onClose?: () => void;
  onPause?: () => void;
  isStreaming?: boolean;
  isPaused?: boolean;
  floating?: boolean;
  exiting?: boolean;
}

const STATUS_GLYPH: Record<TodoItem['status'], string> = {
  pending: '○',
  in_progress: '◐',
  completed: '●',
  cancelled: '⊘',
};

const STATUS_LABEL: Record<TodoItem['status'], string> = {
  pending: 'Pending',
  in_progress: 'In progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

export const TodoPanel: Component<TodoPanelProps> = (props) => {
  const [expanded, setExpanded] = createSignal(false);
  const toggleExpanded = () => setExpanded((v) => !v);

  const completedCount = createMemo(() => props.todos.filter((t) => t.status === 'completed').length);
  const inProgressCount = createMemo(() => props.todos.filter((t) => t.status === 'in_progress').length);
  const progressRatio = createMemo(() =>
    props.todos.length > 0 ? completedCount() / props.todos.length : 0
  );
  const circumference = 2 * Math.PI * 9; // r=9

  return (
    <div
      class={styles.panel}
      classList={{
        [styles.floatingPanel]: !!props.floating,
        [styles.panelExit]: !!props.exiting,
        [styles.panelEnter]: !props.exiting,
      }}
      role="region"
      aria-label="Task list"
    >
      <div class={styles.header}>
        <button
          class={styles.trigger}
          type="button"
          onClick={toggleExpanded}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              toggleExpanded();
            }
          }}
          aria-expanded={expanded()}
          aria-controls="todo-panel-content"
          aria-label={expanded() ? 'Hide task list' : 'Show task list'}
        >
          <span class={styles.chevron}>{expanded() ? '▾' : '▸'}</span>

          <Show when={props.todos.length > 0}>
            <svg class={styles.progressRing} width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
              <circle class={styles.progressRingBg} cx="12" cy="12" r="9" stroke-width={2} fill="none" />
              <circle
                class={styles.progressRingFill}
                cx="12" cy="12" r="9"
                stroke-width={2}
                fill="none"
                stroke-dasharray={`${circumference} ${circumference}`}
                stroke-dashoffset={circumference * (1 - progressRatio())}
                transform="rotate(-90 12 12)"
              />
            </svg>
          </Show>

          <span class={styles.title}>Tasks</span>
          <span class={styles.count}>
            {completedCount()}/{props.todos.length}
          </span>
          <Show when={inProgressCount() > 0}>
            <span class={styles.activeBadge}>{inProgressCount()} active</span>
          </Show>
        </button>

        <div class={styles.headerActions}>
          <Show when={props.isStreaming}>
            <button
              type="button"
              class={styles.actionBtn}
              onClick={(e) => { e.stopPropagation(); props.onPause?.(); }}
              aria-label={props.isPaused ? 'Resume chat' : 'Pause chat'}
              aria-pressed={props.isPaused}
            >
              <Icon name={props.isPaused ? 'play' : 'square'} size={14} />
            </button>
          </Show>
          <button
            type="button"
            class={styles.actionBtn}
            onClick={(e) => { e.stopPropagation(); props.onClose?.(); }}
            aria-label="Close task panel"
          >
            <Icon name="x" size={16} />
          </button>
        </div>
      </div>

      <Show when={expanded()}>
        <div id="todo-panel-content" class={styles.list} role="list">
          <For each={props.todos}>
            {(todo) => (
              <div
                class={`${styles.item} ${styles[todo.status]}`}
                role="listitem"
              >
                <span class={styles.glyph} aria-label={STATUS_LABEL[todo.status]}>
                  {STATUS_GLYPH[todo.status]}
                </span>
                <span class={styles.content}>{todo.content}</span>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
};
