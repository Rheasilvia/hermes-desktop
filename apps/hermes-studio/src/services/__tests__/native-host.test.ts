import { afterEach, describe, expect, it } from 'vitest';
import type { HermesStudioBridge } from '@/shared/native-bridge.js';
import {
  getNativeHost,
  installNativeHostMock,
  isNativeHostAvailable,
} from '../native-host.js';

function fakeHost(label: string): HermesStudioBridge {
  return { label } as unknown as HermesStudioBridge;
}

afterEach(() => {
  Reflect.deleteProperty(window, 'hermesStudio');
});

describe('renderer native host adapter', () => {
  it('detects the frozen preload bridge without exposing generic IPC', () => {
    const host = Object.freeze(fakeHost('preload'));
    Object.defineProperty(window, 'hermesStudio', { configurable: true, value: host });

    expect(getNativeHost()).toBe(host);
    expect(isNativeHostAvailable()).toBe(true);
    expect('invoke' in getNativeHost()!).toBe(false);
    expect('listen' in getNativeHost()!).toBe(false);
  });

  it('returns null in browser preview when no preload bridge is installed', () => {
    expect(getNativeHost()).toBeNull();
    expect(isNativeHostAvailable()).toBe(false);
  });

  it('supports scoped Vitest and Playwright-style injection without mutating window', () => {
    const host = fakeHost('mock');
    const restore = installNativeHostMock(host);

    expect(getNativeHost()).toBe(host);
    expect(window.hermesStudio).toBeUndefined();

    restore();
    expect(getNativeHost()).toBeNull();
  });

  it('can explicitly force browser fallback even when a preload-shaped global exists', () => {
    const preload = fakeHost('preload');
    Object.defineProperty(window, 'hermesStudio', { configurable: true, value: preload });
    const restore = installNativeHostMock(null);

    expect(getNativeHost()).toBeNull();
    restore();
    expect(getNativeHost()).toBe(preload);
  });
});
