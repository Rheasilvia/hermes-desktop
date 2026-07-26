import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  HermesStudioBridge,
  NativeNotificationActionEvent,
  NativeNotificationClickEvent,
} from '@/shared/native-bridge.js';
import { installNativeHostMock } from '@/services/native-host.js';

const storeMocks = vi.hoisted(() => ({
  activeSessionId: 'session-active' as string | null,
  settings: () => ({ ui: {} }),
}));

vi.mock('@/stores/desktop-settings', () => ({
  desktopSettingsStore: { settings: storeMocks.settings },
}));
vi.mock('@/stores/session', () => ({
  sessionStore: {
    get activeSessionId() { return storeMocks.activeSessionId; },
  },
}));

import {
  dispatchNativeNotification,
  setApprovalResponder,
  setSessionFocuser,
  teardownNativeNotifications,
} from './native-notifications.js';

interface NativeHarness {
  host: HermesStudioBridge;
  show: ReturnType<typeof vi.fn>;
  focus: ReturnType<typeof vi.fn>;
  unsubscribe: Array<ReturnType<typeof vi.fn>>;
  action(callback: NativeNotificationActionEvent): void;
  click(callback: NativeNotificationClickEvent): void;
}

function nativeHarness(focused: boolean): NativeHarness {
  let onAction: ((event: NativeNotificationActionEvent) => void) | undefined;
  let onClick: ((event: NativeNotificationClickEvent) => void) | undefined;
  const unsubscribe: Array<ReturnType<typeof vi.fn>> = [];
  const subscription = (set: (callback: never) => void, callback: never) => {
    set(callback);
    const fn = vi.fn();
    unsubscribe.push(fn);
    return fn;
  };
  const show = vi.fn(async () => ({ id: 'notification-1', actionsSupported: true }));
  const focus = vi.fn(async () => undefined);
  const host = {
    app: { nativeState: vi.fn(async () => ({ isPackaged: true, focused, maximized: false })) },
    window: {
      focus,
      onFocus: (callback: (next: boolean) => void) => subscription(() => undefined, callback as never),
    },
    notifications: {
      show,
      onAction: (callback: (event: NativeNotificationActionEvent) => void) => subscription((next) => { onAction = next; }, callback as never),
      onClick: (callback: (event: NativeNotificationClickEvent) => void) => subscription((next) => { onClick = next; }, callback as never),
    },
  } as unknown as HermesStudioBridge;
  return {
    host,
    show,
    focus,
    unsubscribe,
    action: (event) => onAction?.(event),
    click: (event) => onClick?.(event),
  };
}

let restoreHost: (() => void) | undefined;

beforeEach(() => {
  storeMocks.activeSessionId = 'session-active';
});

afterEach(() => {
  setApprovalResponder(null);
  setSessionFocuser(null);
  teardownNativeNotifications();
  restoreHost?.();
  restoreHost = undefined;
});

describe('Electron native notifications', () => {
  it('shows approval actions and routes an action through focus, navigation, and approval', async () => {
    const native = nativeHarness(false);
    restoreHost = installNativeHostMock(native.host);
    const respond = vi.fn(async () => undefined);
    const focusSession = vi.fn();
    setApprovalResponder(respond);
    setSessionFocuser(focusSession);

    await dispatchNativeNotification({
      kind: 'approval',
      title: 'Approval needed',
      body: 'Run command?',
      sessionId: 'session-other',
      approval: { command: 'rm-safe-target' },
    });

    expect(native.show).toHaveBeenCalledWith({
      title: 'Approval needed',
      body: 'Run command?',
      actions: [
        { id: 'approve', title: 'Approve' },
        { id: 'reject', title: 'Reject' },
      ],
      context: { sessionId: 'session-other', command: 'rm-safe-target' },
    });

    native.action({
      id: 'notification-1',
      actionId: 'approve',
      context: { sessionId: 'session-other', command: 'rm-safe-target' },
    });
    await vi.waitFor(() => expect(respond).toHaveBeenCalledWith('session-other', 'rm-safe-target', 'once'));
    expect(native.focus).toHaveBeenCalledOnce();
    expect(focusSession).toHaveBeenCalledWith('session-other');
  });

  it('routes ordinary notification clicks and releases every native subscription', async () => {
    const native = nativeHarness(false);
    restoreHost = installNativeHostMock(native.host);
    const focusSession = vi.fn();
    setSessionFocuser(focusSession);

    await dispatchNativeNotification({
      kind: 'turnDone', title: 'Hermes', body: 'Done', sessionId: 'session-other',
    });
    native.click({ id: 'notification-1', context: { sessionId: 'session-other' } });
    await vi.waitFor(() => expect(native.focus).toHaveBeenCalledOnce());
    expect(focusSession).toHaveBeenCalledWith('session-other');

    teardownNativeNotifications();
    expect(native.unsubscribe.length).toBeGreaterThanOrEqual(3);
    expect(native.unsubscribe.every((unsubscribe) => unsubscribe.mock.calls.length === 1)).toBe(true);
  });

  it('does not notify for the focused active session or in browser preview', async () => {
    const native = nativeHarness(true);
    restoreHost = installNativeHostMock(native.host);
    await dispatchNativeNotification({
      kind: 'turnDone', title: 'Hermes', body: 'Done', sessionId: 'session-active',
    });
    expect(native.show).not.toHaveBeenCalled();

    teardownNativeNotifications();
    restoreHost();
    restoreHost = installNativeHostMock(null);
    await expect(dispatchNativeNotification({
      kind: 'turnDone', title: 'Hermes', body: 'Done', sessionId: 'session-other',
    })).resolves.toBeUndefined();
  });

  it('does not attach listeners or show after teardown supersedes pending initialization', async () => {
    let resolveState!: (state: { isPackaged: boolean; focused: boolean; maximized: boolean }) => void;
    const state = new Promise<{ isPackaged: boolean; focused: boolean; maximized: boolean }>((resolve) => {
      resolveState = resolve;
    });
    const native = nativeHarness(false);
    native.host.app.nativeState = vi.fn(() => state);
    restoreHost = installNativeHostMock(native.host);

    const pending = dispatchNativeNotification({
      kind: 'turnDone', title: 'Hermes', body: 'Done', sessionId: 'session-other',
    });
    teardownNativeNotifications();
    resolveState({ isPackaged: true, focused: false, maximized: false });
    await pending;

    expect(native.unsubscribe).toHaveLength(0);
    expect(native.show).not.toHaveBeenCalled();
  });
});
