/**
 * Native OS notifications exposed by the frozen Electron preload bridge.
 *
 * This is an additive layer over the always-present inline UI. The browser
 * preview intentionally has no native notification implementation.
 */

import { getNativeHost } from '@/services/native-host.js';
import type {
  HermesStudioBridge,
  NativeNotificationContext,
} from '@/shared/native-bridge.js';
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

/** Reads notification preferences from the desktop settings UI bag. */
export function readNativeNotificationPrefs(): NativeNotificationPrefs {
  const ui = desktopSettingsStore.settings().ui as Record<string, unknown> | undefined;
  const prefsNode = ui?.[PREFS_KEY] as Record<string, unknown> | undefined;
  const raw = prefsNode?.['native'] as Partial<NativeNotificationPrefs> | undefined;
  if (!raw) return DEFAULT_PREFS;
  return {
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : DEFAULT_PREFS.enabled,
    kinds: { ...DEFAULT_PREFS.kinds, ...(raw.kinds ?? {}) },
  };
}

let windowFocused = true;
let initializedHost: HermesStudioBridge | null = null;
let initialization: Promise<boolean> | null = null;
let lifecycleGeneration = 0;
const teardownFns: Array<() => void> = [];

/** Resolves an approval action back to the sidecar. Set by the chat layer. */
export type ApprovalResponder = (
  sessionId: string,
  command: string,
  choice: 'once' | 'deny',
) => Promise<void>;
let approvalResponder: ApprovalResponder | null = null;

export function setApprovalResponder(fn: ApprovalResponder | null): void {
  approvalResponder = fn;
}

/** Routes to a session after the native window has been focused. */
export type SessionFocuser = (sessionId: string | null) => void;
let sessionFocuser: SessionFocuser | null = null;

export function setSessionFocuser(fn: SessionFocuser | null): void {
  sessionFocuser = fn;
}

function focusAndRoute(host: HermesStudioBridge, context?: NativeNotificationContext): void {
  void host.window.focus().catch(() => undefined);
  sessionFocuser?.(context?.sessionId ?? null);
}

async function initializeNativeNotifications(host: HermesStudioBridge): Promise<boolean> {
  if (initializedHost === host && initialization) {
    return initialization;
  }

  teardownNativeNotifications();
  initializedHost = host;
  const generation = lifecycleGeneration;
  initialization = (async () => {
    try {
      const state = await host.app.nativeState();
      windowFocused = state.focused;
    } catch {
      windowFocused = true;
    }

    if (generation !== lifecycleGeneration || initializedHost !== host) return false;

    teardownFns.push(host.window.onFocus((focused) => {
      windowFocused = focused;
    }));
    teardownFns.push(host.notifications.onClick((event) => {
      focusAndRoute(host, event.context);
    }));
    teardownFns.push(host.notifications.onAction((event) => {
      focusAndRoute(host, event.context);
      const { sessionId, command } = event.context ?? {};
      if (!sessionId || !command || !approvalResponder) return;
      if (event.actionId === 'approve') {
        void approvalResponder(sessionId, command, 'once');
      } else if (event.actionId === 'reject') {
        void approvalResponder(sessionId, command, 'deny');
      }
    }));
    return true;
  })();

  return initialization;
}

/** Releases every native subscription. Call from the shell on cleanup. */
export function teardownNativeNotifications(): void {
  lifecycleGeneration += 1;
  while (teardownFns.length) {
    const unsubscribe = teardownFns.pop();
    try {
      unsubscribe?.();
    } catch {
      // best-effort cleanup
    }
  }
  initializedHost = null;
  initialization = null;
  windowFocused = true;
}

/** True when the app is unfocused or the event belongs to another session. */
function shouldFire(sessionId: string | undefined): boolean {
  if (!windowFocused) return true;
  const active = sessionStore.activeSessionId;
  return Boolean(sessionId && active && sessionId !== active);
}

export interface DispatchOptions {
  title: string;
  body: string;
  kind: NativeNotificationKind;
  sessionId?: string;
  /** When set, attaches Approve/Reject actions and approval context. */
  approval?: { command: string };
}

/** Sends a native notification when preferences and focus rules allow it. */
export async function dispatchNativeNotification(opts: DispatchOptions): Promise<void> {
  const host = getNativeHost();
  if (!host) return;

  const prefs = readNativeNotificationPrefs();
  if (!prefs.enabled || !prefs.kinds[opts.kind]) return;

  if (!await initializeNativeNotifications(host)) return;
  if (!shouldFire(opts.sessionId)) return;

  const context: NativeNotificationContext | undefined = opts.sessionId
    ? { sessionId: opts.sessionId, ...(opts.approval ? { command: opts.approval.command } : {}) }
    : undefined;

  try {
    await host.notifications.show({
      title: opts.title,
      body: opts.body,
      ...(opts.approval && opts.sessionId
        ? {
            actions: [
              { id: 'approve', title: 'Approve' },
              { id: 'reject', title: 'Reject' },
            ],
          }
        : {}),
      ...(context ? { context } : {}),
    });
  } catch {
    // Native notifications are best-effort; inline UI remains authoritative.
  }
}

/** Convenience wrappers used by the gateway event subscription layer. */
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
