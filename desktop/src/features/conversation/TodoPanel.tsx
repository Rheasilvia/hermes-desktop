import type { Component } from 'solid-js';
import { Show, For, createSignal } from 'solid-js';
import type { TodoItem } from '@/types/gateway.js';
import styles from './TodoPanel.module.css';

interface TodoPanelProps {
  todos: TodoItem[];
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
  const [expanded, setExpanded] = createSignal(true);

  const completedCount = () => props.todos.filter((t) => t.status === 'completed').length;
  const inProgressCount = () => props.todos.filter((t) => t.status === 'in_progress').length;

  return (
    <div class={styles.panel} role="list" aria-label="Task list">
      <button
        type="button"
        class={styles.header}
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded()}
      >
        <span class={styles.chevron}>{expanded() ? '▾' : '▸'}</span>
        <span class={styles.title}>Tasks</span>
        <span class={styles.count}>
          {completedCount()}/{props.todos.length}
        </span>
        <Show when={inProgressCount() > 0}>
          <span class={styles.activeBadge}>{inProgressCount()} active</span>
        </Show>
      </button>

      <Show when={expanded()}>
        <div class={styles.list}>
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
