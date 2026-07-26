import { uiStore } from '@/stores/ui.js';
import { STORAGE_KEYS } from '@/lib/storage-keys.js';
import { loadDesktopSettings, type DesktopSettings } from './desktop-settings.js';

export type ThemeName = 'light' | 'dark';

export function setTheme(name: ThemeName): void {
  document.documentElement.dataset.theme = name;
  uiStore.setTheme(name);
}

function getSystemPreference(): ThemeName {
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  return mq.matches ? 'dark' : 'light';
}

function isValidTheme(t: string | undefined): t is ThemeName {
  return t === 'light' || t === 'dark';
}

/** Initialise theme from desktop settings → localStorage → system preference. */
export async function initTheme(): Promise<void> {
  let theme: ThemeName;

  try {
    const desktop = await loadDesktopSettings();
    if (isValidTheme(desktop.theme)) {
      theme = desktop.theme;
    } else {
      const stored = localStorage.getItem(STORAGE_KEYS.theme);
      theme = isValidTheme(stored ?? undefined) ? stored as ThemeName : getSystemPreference();
    }
  } catch {
    theme = getSystemPreference();
  }

  document.documentElement.dataset.theme = theme;
  uiStore.setTheme(theme);
}
