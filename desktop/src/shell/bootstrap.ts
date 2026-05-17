import { initTheme } from '@/services/theme.js';
import { loadDesktopSettings, applyDesktopSettings } from '@/services/desktop-settings.js';
import { cronStore } from '@/stores/cron.js';
import { analyticsStore } from '@/stores/analytics.js';

const isTauri = typeof window !== 'undefined' && !!(window as unknown as { __TAURI__?: unknown }).__TAURI__;

export async function initBootstrap(): Promise<void> {
  await initTheme();
  try {
    const desktop = await loadDesktopSettings();
    applyDesktopSettings(desktop);
  } catch {
    // theme already initialised
  }
  if (isTauri) {
    try {
      const { listen } = await import('@tauri-apps/api/event');
      const { invoke } = await import('@tauri-apps/api/core');
      await listen('sidecar://ready', () => {
        void cronStore.load();
        void analyticsStore.load();
      });
      try {
        await invoke('sidecar_info');
        void cronStore.load();
        void analyticsStore.load();
      } catch { /* not ready yet */ }
    } catch { /* not in Tauri */ }
  }
}
