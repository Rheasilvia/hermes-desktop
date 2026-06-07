import { createStore, produce } from 'solid-js/store';
import type { UserDisplayPart } from '@/features/conversation/display-parts.js';

export interface QueuedAttachment {
  id: string;
  kind: 'file' | 'folder' | 'image' | 'url' | 'terminal';
  name: string;
  path?: string;
  refText?: string;
  size?: number;
}

export interface QueuedPromptEntry {
  id: string;
  text: string;
  attachments: QueuedAttachment[];
  displayParts?: UserDisplayPart[];
  queuedAt: number;
}

export interface AutoDrainSettleInput {
  wasBusy: boolean;
  isBusy: boolean;
  queueLength: number;
  userInterrupted: boolean;
}

type QueueState = Record<string, QueuedPromptEntry[]>;

const STORAGE_KEY = 'hermes.tauri.composerQueue.v1';

function sidOf(key: string | null | undefined): string | null {
  const trimmed = key?.trim();
  return trimmed ? trimmed : null;
}

function loadQueueState(): QueueState {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as QueueState : {};
  } catch {
    return {};
  }
}

function saveQueueState(state: QueueState): void {
  if (typeof window === 'undefined') return;
  try {
    if (Object.keys(state).length === 0) {
      window.localStorage.removeItem(STORAGE_KEY);
    } else {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    }
  } catch {
    // Storage can be unavailable; the in-memory queue remains usable.
  }
}

const [queuesBySession, setQueuesBySession] = createStore<QueueState>(loadQueueState());

function cloneAttachments(attachments: QueuedAttachment[] = []): QueuedAttachment[] {
  return attachments.map((attachment) => ({ ...attachment }));
}

function cloneDisplayParts(displayParts: UserDisplayPart[] = []): UserDisplayPart[] {
  return displayParts.map((part) => ({ ...part }));
}

function nextId(): string {
  return `queued-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function snapshot(): QueueState {
  return Object.fromEntries(
    Object.entries(queuesBySession).map(([sid, entries]) => [sid, entries.map((entry) => ({
      ...entry,
      attachments: cloneAttachments(entry.attachments),
      displayParts: cloneDisplayParts(entry.displayParts),
    }))]),
  );
}

function persist(): void {
  saveQueueState(snapshot());
}

function writeSession(sessionId: string, entries: QueuedPromptEntry[]): void {
  if (entries.length === 0) {
    setQueuesBySession(produce((state) => {
      delete state[sessionId];
    }));
  } else {
    setQueuesBySession(sessionId, entries);
  }
  persist();
}

export const composerQueueStore = {
  getQueuedPrompts(key: string | null | undefined): QueuedPromptEntry[] {
    const sid = sidOf(key);
    return sid
      ? (queuesBySession[sid] ?? []).map((entry) => ({
        ...entry,
        attachments: cloneAttachments(entry.attachments),
        displayParts: cloneDisplayParts(entry.displayParts),
      }))
      : [];
  },

  enqueue(
    key: string | null | undefined,
    payload: { text: string; attachments?: QueuedAttachment[]; displayParts?: UserDisplayPart[] },
  ): QueuedPromptEntry | null {
    const sid = sidOf(key);
    if (!sid) return null;
    const entry: QueuedPromptEntry = {
      id: nextId(),
      text: payload.text,
      attachments: cloneAttachments(payload.attachments),
      displayParts: cloneDisplayParts(payload.displayParts),
      queuedAt: Date.now(),
    };
    writeSession(sid, [...(queuesBySession[sid] ?? []), entry]);
    return entry;
  },

  dequeue(key: string | null | undefined): QueuedPromptEntry | null {
    const sid = sidOf(key);
    if (!sid) return null;
    const [head, ...rest] = queuesBySession[sid] ?? [];
    if (!head) return null;
    writeSession(sid, rest);
    return { ...head, attachments: cloneAttachments(head.attachments), displayParts: cloneDisplayParts(head.displayParts) };
  },

  clear(key: string | null | undefined): void {
    const sid = sidOf(key);
    if (!sid) return;
    writeSession(sid, []);
  },

  clearAll(): void {
    setQueuesBySession(produce((state) => {
      for (const sid of Object.keys(state)) {
        delete state[sid];
      }
    }));
    persist();
  },
};

export function shouldAutoDrainOnSettle(params: AutoDrainSettleInput): boolean {
  if (params.isBusy || !params.wasBusy) return false;
  if (params.userInterrupted) return false;
  return params.queueLength > 0;
}
