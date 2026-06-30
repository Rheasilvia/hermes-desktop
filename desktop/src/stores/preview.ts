import { createStore, produce } from 'solid-js/store';

export interface FileUrlPreviewTarget {
  kind: 'file' | 'url';
  label: string;
  source: string;
  url: string;
  path?: string;
  language?: string;
  mimeType?: string;
  previewKind?: 'binary' | 'html' | 'image' | 'text';
  renderMode?: 'preview' | 'source';
}

export interface PlanPreviewTarget {
  kind: 'plan';
  label: string;
  sessionId: string;
  blockId: string;
  messageId?: string;
}

export interface NotebookPreviewTarget {
  kind: 'notebook';
  label: string;
  path: string;
}

export type PreviewTarget = FileUrlPreviewTarget | PlanPreviewTarget | NotebookPreviewTarget;

export type PreviewRecordSource = 'explicit-link' | 'file-browser' | 'manual' | 'tool-result' | 'plan-card' | 'notebook';

export interface SessionPreviewRecord {
  autoOpen: boolean;
  createdAt: number;
  dismissedAt?: number;
  id: string;
  normalized: PreviewTarget;
  sessionId: string;
  source: PreviewRecordSource;
  target: string;
}

type PreviewRegistry = Record<string, SessionPreviewRecord[]>;

const STORAGE_KEY = 'hermes.tauri.sessionPreviews.v2';
const MAX_RECORDS_PER_SESSION = 1;
const MAX_SESSIONS = 120;

function isSourcePreview(source: PreviewRecordSource): boolean {
  return source === 'file-browser' || source === 'manual';
}

function normalizeTargetForSource(target: FileUrlPreviewTarget, source: PreviewRecordSource): FileUrlPreviewTarget {
  if (target.kind !== 'file' || target.previewKind !== 'html') return target;
  return { ...target, renderMode: isSourcePreview(source) ? 'source' : 'preview' };
}

function pruneRegistry(registry: PreviewRegistry): PreviewRegistry {
  return Object.fromEntries(
    Object.entries(registry)
      .map(([sessionId, records]) => [
        sessionId,
        [...records].sort((a, b) => b.createdAt - a.createdAt).slice(0, MAX_RECORDS_PER_SESSION),
      ] as const)
      .filter(([, records]) => records.length > 0)
      .sort(([, a], [, b]) => (b[0]?.createdAt ?? 0) - (a[0]?.createdAt ?? 0))
      .slice(0, MAX_SESSIONS),
  );
}

function isPreviewTarget(value: unknown): value is PreviewTarget {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  if (row.kind === 'plan') {
    return (
      typeof row.label === 'string' &&
      typeof row.sessionId === 'string' &&
      typeof row.blockId === 'string' &&
      (row.messageId === undefined || typeof row.messageId === 'string')
    );
  }
  if (row.kind === 'notebook') {
    return (
      typeof row.label === 'string' &&
      typeof row.path === 'string'
    );
  }
  return (
    (row.kind === 'file' || row.kind === 'url') &&
    typeof row.label === 'string' &&
    typeof row.source === 'string' &&
    typeof row.url === 'string'
  );
}

function isPreviewRecord(value: unknown): value is SessionPreviewRecord {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.autoOpen === 'boolean' &&
    typeof row.createdAt === 'number' &&
    typeof row.id === 'string' &&
    isPreviewTarget(row.normalized) &&
    typeof row.sessionId === 'string' &&
    ['explicit-link', 'file-browser', 'manual', 'tool-result', 'plan-card', 'notebook'].includes(String(row.source)) &&
    typeof row.target === 'string' &&
    (row.dismissedAt === undefined || typeof row.dismissedAt === 'number')
  );
}

function loadRegistry(): PreviewRegistry {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) as Record<string, unknown> : null;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: PreviewRegistry = {};
    for (const [sessionId, records] of Object.entries(parsed)) {
      if (!Array.isArray(records)) continue;
      const valid = records.filter(isPreviewRecord);
      if (valid.length > 0) out[sessionId] = valid;
    }
    return pruneRegistry(out);
  } catch {
    return {};
  }
}

function saveRegistry(registry: PreviewRegistry): void {
  if (typeof window === 'undefined') return;
  try {
    const pruned = pruneRegistry(registry);
    if (Object.keys(pruned).length === 0) {
      window.localStorage.removeItem(STORAGE_KEY);
    } else {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(pruned));
    }
  } catch {
    // Preview persistence is a convenience; failures are non-fatal.
  }
}

const [registry, setRegistry] = createStore<PreviewRegistry>(loadRegistry());

function snapshot(): PreviewRegistry {
  return Object.fromEntries(
    Object.entries(registry).map(([sessionId, records]) => [
      sessionId,
      records.map((record) => ({ ...record, normalized: { ...record.normalized } })),
    ]),
  );
}

function targetKey(target: PreviewTarget): string {
  if (target.kind === 'plan') {
    return `plan:${target.sessionId}:${target.messageId ?? 'live'}:${target.blockId}`;
  }
  if (target.kind === 'notebook') {
    return `notebook:${target.path}`;
  }
  return target.url;
}

function recordId(sessionId: string, target: PreviewTarget): string {
  if (target.kind === 'plan') return targetKey(target);
  if (target.kind === 'notebook') return `notebook:${sessionId}:${target.path}`;
  return `${sessionId}:${target.url}`;
}

export const previewStore = {
  register(
    sessionId: string | null | undefined,
    target: FileUrlPreviewTarget,
    source: PreviewRecordSource,
    rawTarget = target.source,
  ): SessionPreviewRecord | null {
    const sid = sessionId?.trim();
    if (!sid) return null;
    const normalized = normalizeTargetForSource(target, source);
    const existing = registry[sid]?.find((record) =>
      (record.normalized.kind === 'file' || record.normalized.kind === 'url')
      && record.normalized.url === normalized.url
    );
    const record: SessionPreviewRecord = {
      autoOpen: true,
      createdAt: Date.now(),
      id: existing?.id ?? recordId(sid, target),
      normalized,
      sessionId: sid,
      source,
      target: rawTarget || target.source,
    };
    setRegistry(produce((state) => {
      state[sid] = [record];
    }));
    saveRegistry(snapshot());
    return record;
  },

  registerPlan(
    sessionId: string | null | undefined,
    target: { blockId: string; label?: string | null; messageId?: string | number | null },
  ): SessionPreviewRecord | null {
    const sid = sessionId?.trim();
    const blockId = target.blockId.trim();
    if (!sid || !blockId) return null;
    const normalized: PlanPreviewTarget = {
      kind: 'plan',
      label: target.label?.trim() || 'Plan',
      sessionId: sid,
      blockId,
      messageId: target.messageId == null ? undefined : String(target.messageId),
    };
    const existing = registry[sid]?.find((record) => targetKey(record.normalized) === targetKey(normalized));
    const record: SessionPreviewRecord = {
      autoOpen: true,
      createdAt: Date.now(),
      id: existing?.id ?? recordId(sid, normalized),
      normalized,
      sessionId: sid,
      source: 'plan-card',
      target: `plan:${blockId}`,
    };
    setRegistry(produce((state) => {
      state[sid] = [record];
    }));
    saveRegistry(snapshot());
    return record;
  },

  registerNotebook(
    sessionId: string | null | undefined,
    target: { path: string; label?: string | null },
  ): SessionPreviewRecord | null {
    const sid = sessionId?.trim();
    const path = target.path?.trim();
    if (!sid || !path) return null;
    const normalized: NotebookPreviewTarget = {
      kind: 'notebook',
      label: target.label?.trim() || path.split(/[\\/]/).filter(Boolean).pop() || path,
      path,
    };
    const existing = registry[sid]?.find((record) => targetKey(record.normalized) === targetKey(normalized));
    const record: SessionPreviewRecord = {
      autoOpen: true,
      createdAt: Date.now(),
      id: existing?.id ?? recordId(sid, normalized),
      normalized,
      sessionId: sid,
      source: 'notebook',
      target: `notebook:${path}`,
    };
    setRegistry(produce((state) => {
      state[sid] = [record];
    }));
    saveRegistry(snapshot());
    return record;
  },

  get(sessionId: string | null | undefined): SessionPreviewRecord | null {
    const sid = sessionId?.trim();
    if (!sid) return null;
    return registry[sid]?.find((record) => record.autoOpen && !record.dismissedAt) ?? null;
  },

  dismiss(sessionId: string | null | undefined, url?: string): void {
    const sid = sessionId?.trim();
    if (!sid) return;
    const records = registry[sid];
    if (!records?.length) return;
    const targetUrl = url ?? records.find((record) => !record.dismissedAt)?.normalized;
    if (!targetUrl) return;
    const key = typeof targetUrl === 'string' ? targetUrl : targetKey(targetUrl);
    const dismissedAt = Date.now();
    setRegistry(sid, records.map((record) => (
      targetKey(record.normalized) === key
        ? { ...record, autoOpen: false, dismissedAt }
        : record
    )));
    saveRegistry(snapshot());
  },

  clearAll(): void {
    setRegistry(produce((state) => {
      for (const sessionId of Object.keys(state)) {
        delete state[sessionId];
      }
    }));
    saveRegistry(snapshot());
  },
};
