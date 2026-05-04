import { uiStore } from '@/stores/ui.js';
import { loadDesktopSettings, type DesktopSettings } from './desktop-settings.js';

export type ThemeName = 'light' | 'dark' | 'earth';

const THEMES: ThemeName[] = ['light', 'dark', 'earth'];
const STORAGE_KEY_THEME = 'hermes-desktop-theme';

export function setTheme(name: ThemeName): void {
  document.documentElement.dataset.theme = name;
  uiStore.setTheme(name);
}

export function getTheme(): ThemeName {
  return uiStore.theme as ThemeName;
}

export function cycleTheme(): ThemeName {
  const current = getTheme();
  const idx = THEMES.indexOf(current);
  const next = THEMES[(idx + 1) % THEMES.length];
  setTheme(next);
  return next;
}

function getSystemPreference(): ThemeName {
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  return mq.matches ? 'dark' : 'light';
}

function isValidTheme(t: string | undefined): t is ThemeName {
  return t === 'light' || t === 'dark' || t === 'earth';
}

/** Initialise theme from desktop settings → localStorage → system preference. */
export async function initTheme(): Promise<void> {
  let theme: ThemeName;

  try {
    const desktop = await loadDesktopSettings();
    if (isValidTheme(desktop.theme)) {
      theme = desktop.theme;
    } else {
      const stored = localStorage.getItem(STORAGE_KEY_THEME);
      theme = isValidTheme(stored ?? undefined) ? stored as ThemeName : getSystemPreference();
    }
  } catch {
    theme = getSystemPreference();
  }

  document.documentElement.dataset.theme = theme;
  uiStore.setTheme(theme);
}
