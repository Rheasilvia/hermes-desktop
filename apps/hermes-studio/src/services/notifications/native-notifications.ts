/**
 * Native OS notifications via @tauri-apps/plugin-notification.
 *
 * Additive layer on top of the always-present inline UI (approval cards,
 * toasts). Fires an OS notification only when the app window is unfocused
 * OR the event belongs to a session other than the active one — matching
 * the Electron reference implementation's `shouldFire` heuristic.
 *
 * Approval action buttons (Approve/Reject) attach directly to the
 * notification's `actions` and resolve via the `onAction` callback, which
 * receives `notification.actionId`. On platforms where the OS drops action
 * buttons (Windows / unsigned macOS), the notification body still shows and
 * the `onAction` callback simply never fires; the inline approval card is
 * always rendered regardless, so the user is never blocked.
 *
 * All Tauri APIs are behind an `isTauri()` gate + dynamic import so this
 * module is inert in the browser/vite-preview environment.
 */

import { isTauri } from '@tauri-apps/api/core';
import { desktopSettingsStore } from '@/stores/desktop-settings';
import { sessionStore } from '@/stores/session';

/** The five independently-toggleable notification kinds. */
export type NativeNotificationKind =
  | 'approval'
  | 'input'
  | 'turnDone'
  | 'turnError'
  | 'backgroundDone';

export interface NativeNotificationPrefs {
  enabled: boolean;
  kinds: Record<NativeNotificationKind, boolean>;
}

const DEFAULT_PREFS: NativeNotificationPrefs = {
  enabled: true,
  kinds: { approval: true, input: true, turnDone: true, turnError: true, backgroundDone: true },
};

const PREFS_KEY = 'notifications';

/**
 * Reads the native-notification prefs from the desktop settings store's
 * opaque `ui` bag, deep-merging over defaults so a missing key never blocks
 * dispatch.
 */
export function readNativeNotificationPrefs(): NativeNotificationPrefs {
  const ui = desktopSettingsStore.settings().ui as Record<string, unknown> | undefined;
  const prefsNode = (ui?.[PREFS_KEY] as Record<string, unknown> | undefined);
  const raw = prefsNode?.['native'] as Partial<NativeNotificationPrefs> | undefined;
  if (!raw) return DEFAULT_PREFS;
  return {
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : DEFAULT_PREFS.enabled,
    kinds: { ...DEFAULT_PREFS.kinds, ...(raw.kinds ?? {}) },
  };
}

// ---------------------------------------------------------------------------
// Window-focus tracking (does not exist elsewhere in the app today).
// ---------------------------------------------------------------------------

let windowFocused = true;
let focusInitialized = false;

// Teardown handles for listeners attached during init. Kept so the shell can
// release them on unmount/reload instead of leaking across navigations.
const teardownFns: Array<() => void> = [];

async function initFocusTracking(): Promise<void> {
  if (focusInitialized || !isTauri()) return;
  focusInitialized = true;
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  const win = getCurrentWindow();
  windowFocused = await win.isFocused();
  const unlisten = await win.onFocusChanged(({ payload: focused }: { payload: boolean }) => {
    windowFocused = focused;
  });
  teardownFns.push(unlisten);
}

/** Releases every native-notification listener. Call from the shell onCleanup. */
export function teardownNativeNotifications(): void {
  while (teardownFns.length) {
    const fn = teardownFns.pop();
    try { fn?.(); } catch { /* best-effort */ }
  }
  focusInitialized = false;
  actionListenerAttached = false;
}

/** True when the app window is unfocused OR the event is for a non-active session. */
function shouldFire(sessionId: string | undefined): boolean {
  if (!windowFocused) return true;
  const active = sessionStore.activeSessionId;
  if (sessionId && active && sessionId !== active) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Action callback + dispatch.
// ---------------------------------------------------------------------------

/** Pending approval context, carried in the notification's `extra` payload. */
interface PendingApproval {
  sessionId: string;
  command: string;
}

/** Resolves an approval action back to the sidecar. Set by the chat layer. */
export type ApprovalResponder = (sessionId: string, command: string, choice: 'once' | 'deny') => Promise<void>;
let approvalResponder: ApprovalResponder | null = null;

/** The chat/event layer registers how an approval choice is sent to the sidecar. */
export function setApprovalResponder(fn: ApprovalResponder | null): void {
  approvalResponder = fn;
}

/** Focuses the window and routes to a session — set by the shell layer. */
export type SessionFocuser = (sessionId: string | null) => void;
let sessionFocuser: SessionFocuser | null = null;

/** The shell layer registers how a notification click focuses + routes. */
export function setSessionFocuser(fn: SessionFocuser | null): void {
  sessionFocuser = fn;
}

let actionListenerAttached = false;

async function ensureActionListener(): Promise<void> {
  if (actionListenerAttached || !isTauri()) return;
  actionListenerAttached = true;
  const { onAction } = await import('@tauri-apps/plugin-notification');
  // The callback receives the notification Options the action was attached
  // to, plus `actionId` identifying the pressed button. We stash the
  // approval context in `extra` at send time and resolve it here.
  const unlisten = await onAction((notification) => {
    const n = notification as unknown as Record<string, unknown>;
    const actionId = n['actionId'] as string | undefined;
    const extra = n['extra'] as PendingApproval | undefined;
    if (!extra || !approvalResponder) return;
    if (actionId === 'approve') {
      void approvalResponder(extra.sessionId, extra.command, 'once');
    } else if (actionId === 'reject') {
      void approvalResponder(extra.sessionId, extra.command, 'deny');
    }
  });
  teardownFns.push(unlisten as unknown as () => void);
}

export interface DispatchOptions {
  title: string;
  body: string;
  kind: NativeNotificationKind;
  sessionId?: string;
  /** When set, attaches Approve/Reject action buttons + carries approval context. */
  approval?: { command: string };
}

/**
 * Sends a native notification if prefs allow this kind AND the shouldFire
 * heuristic passes. No-op (not even an error) when filtered out.
 */
export async function dispatchNativeNotification(opts: DispatchOptions): Promise<void> {
  if (!isTauri()) return;
  const prefs = readNativeNotificationPrefs();
  if (!prefs.enabled || !prefs.kinds[opts.kind]) return;
  if (!shouldFire(opts.sessionId)) return;

  await Promise.all([initFocusTracking(), ensureActionListener()]);

  const mod = await import('@tauri-apps/plugin-notification');
  // Permission may be undetermined; request once. Failures are non-fatal.
  try {
    const already = typeof mod.isPermissionGranted === 'function' ? await mod.isPermissionGranted() : true;
    if (!already) {
      const permission = typeof mod.requestPermission === 'function' ? await mod.requestPermission() : true;
      if (permission !== true && permission !== 'granted') return;
    }
  } catch {
    return;
  }

  if (opts.approval && opts.sessionId) {
    try {
      // The runtime supports actions/extra/actionTypeId even though the
      // published Options type omits them; cast to satisfy tsc.
      const notificationOpts = {
        title: opts.title,
        body: opts.body,
        actionTypeId: 'approval',
        actions: [
          { id: 'approve', title: 'Approve' },
          { id: 'reject', title: 'Reject' },
        ],
        extra: { sessionId: opts.sessionId, command: opts.approval.command } satisfies PendingApproval,
      };
      mod.sendNotification(notificationOpts as Parameters<typeof mod.sendNotification>[0]);
    } catch {
      /* best-effort */
    }
    return;
  }

  try {
    mod.sendNotification({ title: opts.title, body: opts.body });
  } catch {
    /* best-effort */
  }
}

/**
 * Convenience wrappers for the five kinds. These are what the event
 * subscription layer calls.
 */
export const nativeNotifications = {
  approval(sessionId: string, command: string, description: string): void {
    void dispatchNativeNotification({
      kind: 'approval',
      title: 'Approval needed',
      body: description || command,
      sessionId,
      approval: { command },
    });
  },
  input(sessionId: string | undefined, title: string, body: string): void {
    void dispatchNativeNotification({ kind: 'input', title, body, sessionId });
  },
  turnDone(sessionId: string | undefined): void {
    void dispatchNativeNotification({ kind: 'turnDone', title: 'Hermes', body: 'Response complete', sessionId });
  },
  turnError(sessionId: string | undefined, message: string): void {
    void dispatchNativeNotification({ kind: 'turnError', title: 'Hermes', body: message, sessionId });
  },
  backgroundDone(sessionId: string | undefined, title: string): void {
    void dispatchNativeNotification({ kind: 'backgroundDone', title: 'Hermes', body: title, sessionId });
  },
};
