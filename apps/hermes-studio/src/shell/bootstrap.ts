import { initTheme } from '@/services/theme.js';
import { loadDesktopSettings, applyDesktopSettings } from '@/services/desktop-settings.js';
import { cronStore } from '@/stores/cron.js';
import { analyticsStore } from '@/stores/analytics.js';
import { getNativeHost } from '@/services/native-host.js';
import { httpClient } from '@/services/api/http-client.js';
import type { SidecarInfo } from '@/shared/native-bridge.js';

export async function initBootstrap(): Promise<() => void> {
  await initTheme();
  try {
    const desktop = await loadDesktopSettings();
    applyDesktopSettings(desktop);
  } catch {
    // theme already initialised
  }
  const nativeHost = getNativeHost();
  if (!nativeHost) return () => undefined;

  const refresh = (info: SidecarInfo) => {
    httpClient.updateBackendInfo(info);
    void cronStore.load();
    void analyticsStore.load();
  };
  const unsubscribes = [
    nativeHost.backend.onReady(refresh),
    nativeHost.backend.onRestarted(refresh),
  ];
  try {
    refresh(await nativeHost.backend.info());
  } catch {
    // The lifecycle subscriptions remain active while the sidecar starts.
  }
  return () => {
    for (const unsubscribe of unsubscribes) unsubscribe();
  };
}
