import { createStore } from 'solid-js/store';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface ToastAction {
  label: string;
  /** Called when the action button is clicked. The toast is dismissed after. */
  onClick: () => void;
}

export interface ToastEntry {
  id: number;
  type: ToastType;
  message: string;
  /** Optional inline action (e.g. "Open" for a created PR link). */
  action?: ToastAction;
  /** Auto-dismiss timeout in ms; 0 keeps it until dismissed. */
  duration: number;
}

export interface ToastInput {
  type?: ToastType;
  message: string;
  action?: ToastAction;
  duration?: number;
}

const [toasts, setToasts] = createStore<ToastEntry[]>([]);
let nextId = 1;
const timers = new Map<number, ReturnType<typeof setTimeout>>();

function dismiss(id: number): void {
  const timer = timers.get(id);
  if (timer) {
    clearTimeout(timer);
    timers.delete(id);
  }
  setToasts((current) => current.filter((entry) => entry.id !== id));
}

function push(input: ToastInput): number {
  const id = nextId;
  nextId += 1;
  const duration = input.duration ?? (input.type === 'error' ? 6000 : 4000);
  setToasts((current) => [
    ...current,
    {
      id,
      type: input.type ?? 'info',
      message: input.message,
      action: input.action,
      duration,
    },
  ]);
  if (duration > 0) {
    timers.set(id, setTimeout(() => dismiss(id), duration));
  }
  return id;
}

export const toastStore = {
  list: toasts,
  push,
  dismiss,
  success(message: string, action?: ToastAction): number {
    return push({ type: 'success', message, action });
  },
  error(message: string, action?: ToastAction): number {
    return push({ type: 'error', message, action });
  },
  info(message: string, action?: ToastAction): number {
    return push({ type: 'info', message, action });
  },
  /** Test helper: clear everything and reset the id counter. */
  resetForTests(): void {
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
    setToasts([]);
    nextId = 1;
  },
};
