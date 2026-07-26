import { createMemo } from 'solid-js';
import { createStore } from 'solid-js/store';
import type { BackgroundCompletePayload, BtwCompletePayload } from '@/types/gateway.js';

export interface BackgroundTaskRecord {
  id: string;
  status: 'complete' | 'notice';
  title: string;
  preview: string;
  completedAt: number;
}

interface BackgroundTasksState {
  tasks: Record<string, BackgroundTaskRecord>;
}

const MAX_BACKGROUND_TASKS = 20;

const [state, setState] = createStore<BackgroundTasksState>({
  tasks: {},
});

function pruneTasks(): void {
  const records = Object.values(state.tasks).sort((a, b) => b.completedAt - a.completedAt);
  for (const stale of records.slice(MAX_BACKGROUND_TASKS)) {
    setState('tasks', (tasks) => {
      const next = { ...tasks };
      delete next[stale.id];
      return next;
    });
  }
}

export const backgroundTaskStore = {
  get tasks() { return state.tasks; },

  handleComplete(payload: BackgroundCompletePayload): void {
    const id = payload.task_id || `background-${Date.now()}`;
    setState('tasks', id, {
      id,
      status: 'complete',
      title: `Background task ${id.slice(0, 8)}`,
      preview: payload.text,
      completedAt: Date.now(),
    });
    pruneTasks();
  },

  handleBtwComplete(payload: BtwCompletePayload): void {
    const id = `btw-${Date.now()}`;
    setState('tasks', id, {
      id,
      status: 'notice',
      title: 'Background note',
      preview: payload.text,
      completedAt: Date.now(),
    });
    pruneTasks();
  },

  dismiss(id: string): void {
    setState('tasks', (tasks) => {
      const next = { ...tasks };
      delete next[id];
      return next;
    });
  },

  clear(): void {
    setState('tasks', {});
  },
};

export const recentBackgroundTasks = createMemo(() =>
  Object.values(state.tasks).sort((a, b) => b.completedAt - a.completedAt),
);
