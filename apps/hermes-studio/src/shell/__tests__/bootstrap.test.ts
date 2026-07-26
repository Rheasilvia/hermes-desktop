import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HermesStudioBridge, SidecarInfo } from '@/shared/native-bridge.js';
import { installNativeHostMock } from '@/services/native-host.js';

const mocks = vi.hoisted(() => ({
  initTheme: vi.fn(async () => undefined),
  loadDesktopSettings: vi.fn(async () => ({ theme: 'light' })),
  applyDesktopSettings: vi.fn(),
  cronLoad: vi.fn(async () => undefined),
  analyticsLoad: vi.fn(async () => undefined),
  updateBackendInfo: vi.fn(),
}));

vi.mock('@/services/theme.js', () => ({ initTheme: mocks.initTheme }));
vi.mock('@/services/desktop-settings.js', () => ({
  loadDesktopSettings: mocks.loadDesktopSettings,
  applyDesktopSettings: mocks.applyDesktopSettings,
}));
vi.mock('@/stores/cron.js', () => ({ cronStore: { load: mocks.cronLoad } }));
vi.mock('@/stores/analytics.js', () => ({ analyticsStore: { load: mocks.analyticsLoad } }));
vi.mock('@/services/api/http-client.js', () => ({
  httpClient: { updateBackendInfo: mocks.updateBackendInfo },
}));

import { initBootstrap } from '../bootstrap.js';

interface BackendCallbacks {
  ready?: (info: SidecarInfo) => void;
  restarted?: (info: SidecarInfo) => void;
}

function nativeHost(callbacks: BackendCallbacks, unsubscribes: Array<ReturnType<typeof vi.fn>>): HermesStudioBridge {
  const subscribe = <T>(key: keyof BackendCallbacks, callback: (event: T) => void) => {
    callbacks[key] = callback as never;
    const unsubscribe = vi.fn();
    unsubscribes.push(unsubscribe);
    return unsubscribe;
  };
  return {
    backend: {
      info: vi.fn(async () => ({ baseUrl: 'http://127.0.0.1:42001', token: 'initial' })),
      onReady: (callback: (info: SidecarInfo) => void) => subscribe('ready', callback),
      onRestarted: (callback: (info: SidecarInfo) => void) => subscribe('restarted', callback),
    },
  } as unknown as HermesStudioBridge;
}

let restoreHost: (() => void) | undefined;

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  restoreHost?.();
  restoreHost = undefined;
});

describe('initBootstrap native lifecycle', () => {
  it('hydrates from initial backend info, refreshes on restart, and unsubscribes', async () => {
    const callbacks: BackendCallbacks = {};
    const unsubscribes: Array<ReturnType<typeof vi.fn>> = [];
    restoreHost = installNativeHostMock(nativeHost(callbacks, unsubscribes));

    const dispose = await initBootstrap();

    expect(mocks.updateBackendInfo).toHaveBeenCalledWith({
      baseUrl: 'http://127.0.0.1:42001', token: 'initial',
    });
    expect(mocks.cronLoad).toHaveBeenCalledOnce();
    expect(mocks.analyticsLoad).toHaveBeenCalledOnce();

    callbacks.restarted?.({ baseUrl: 'http://127.0.0.1:42002', token: 'fresh' });
    expect(mocks.updateBackendInfo).toHaveBeenLastCalledWith({
      baseUrl: 'http://127.0.0.1:42002', token: 'fresh',
    });
    expect(mocks.cronLoad).toHaveBeenCalledTimes(2);
    expect(mocks.analyticsLoad).toHaveBeenCalledTimes(2);

    dispose();
    expect(unsubscribes).toHaveLength(2);
    expect(unsubscribes.every((unsubscribe) => unsubscribe.mock.calls.length === 1)).toBe(true);
  });

  it('keeps browser preview native-free while still applying UI settings', async () => {
    restoreHost = installNativeHostMock(null);

    const dispose = await initBootstrap();

    expect(mocks.initTheme).toHaveBeenCalledOnce();
    expect(mocks.applyDesktopSettings).toHaveBeenCalledOnce();
    expect(mocks.updateBackendInfo).not.toHaveBeenCalled();
    expect(dispose).toEqual(expect.any(Function));
  });
});
