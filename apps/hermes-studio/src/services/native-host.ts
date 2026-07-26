import type { HermesStudioBridge } from '@/shared/native-bridge.js';

let injectedHost: HermesStudioBridge | null | undefined;

/**
 * Returns the typed, high-level preload bridge when Studio runs in Electron.
 * Browser preview stays intentionally native-free. No raw IPC primitive is
 * exposed or recreated in renderer code.
 */
export function getNativeHost(): HermesStudioBridge | null {
  if (injectedHost !== undefined) return injectedHost;
  if (typeof window === 'undefined') return null;
  return window.hermesStudio ?? null;
}

export function isNativeHostAvailable(): boolean {
  return getNativeHost() !== null;
}

/**
 * Scoped injection point for Vitest and Playwright browser fixtures. Production
 * code discovers only the frozen contextBridge value on `window`.
 */
export function installNativeHostMock(host: HermesStudioBridge | null): () => void {
  const previous = injectedHost;
  injectedHost = host;
  let installed = true;
  return () => {
    if (!installed) return;
    installed = false;
    injectedHost = previous;
  };
}
