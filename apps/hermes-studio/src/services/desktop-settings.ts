import { invoke, isTauri } from '@tauri-apps/api/core';
import templateSettings from '@/assets/desktop-settings-template.json';

const SETTINGS_PATH = 'desktop/settings.json';
const LOCALSTORAGE_KEY = 'hermes-desktop-settings';

export interface DesktopSettings {
  theme: 'light' | 'dark';
  language: string;
  fontSize: number;
  reducedMotion: boolean;
  autoSave: boolean;
  confirmDestructive: boolean;
  startupBehavior: 'restore' | 'new';
  checkUpdates: boolean;
  showCost: boolean;
  showReasoning: boolean;
}

const DEFAULT_SETTINGS: DesktopSettings = {
  ...(templateSettings as DesktopSettings),
};

export async function loadDesktopSettings(): Promise<DesktopSettings> {
  if (!isTauri()) {
    // Web preview mode — fall back to localStorage
    try {
      const raw = localStorage.getItem(LOCALSTORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<DesktopSettings>;
        return { ...DEFAULT_SETTINGS, ...parsed };
      }
    } catch {
      // ignore parse errors
    }
    return { ...DEFAULT_SETTINGS };
  }

  try {
    const content = await invoke<string>('read_file', { path: SETTINGS_PATH });
    const parsed = JSON.parse(content) as Partial<DesktopSettings>;
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveDesktopSettings(settings: DesktopSettings): Promise<void> {
  if (!isTauri()) {
    // Web preview mode — fall back to localStorage
    try {
      localStorage.setItem(LOCALSTORAGE_KEY, JSON.stringify(settings));
    } catch {
      // ignore quota errors
    }
    return;
  }

  await invoke('write_file', {
    path: SETTINGS_PATH,
    content: JSON.stringify(settings, null, 2),
  });
}

/**
 * Apply desktop settings to the DOM.
 * Call this after loading settings and after any setting change.
 */
export function applyDesktopSettings(settings: DesktopSettings): void {
  const root = document.documentElement;

  // Theme
  root.dataset.theme = settings.theme;

  // Font size scale — applied as a percentage on the root so all rem units scale
  root.style.fontSize = `${settings.fontSize}%`;

  // Reduced motion
  if (settings.reducedMotion) {
    root.dataset.reducedMotion = 'true';
  } else {
    delete root.dataset.reducedMotion;
  }

  // Language
  root.lang = settings.language;
}
