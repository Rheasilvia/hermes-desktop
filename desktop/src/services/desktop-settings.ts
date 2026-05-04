interface TauriCore {
  invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T>;
}

interface TauriWindow extends Window {
  __TAURI__?: {
    core: TauriCore;
  };
}

const SETTINGS_PATH = 'desktop/settings.json';
const LOCALSTORAGE_KEY = 'hermes-desktop-settings';

export interface DesktopSettings {
  theme: 'light' | 'dark' | 'earth';
  language: string;
  fontSize: number;
  reducedMotion: boolean;
  autoSave: boolean;
  confirmDestructive: boolean;
  startupBehavior: 'restore' | 'new';
  checkUpdates: boolean;
}

import templateSettings from '@/assets/desktop-settings-template.json';

const DEFAULT_SETTINGS: DesktopSettings = {
  ...(templateSettings as DesktopSettings),
};

function getTauri(): TauriCore | null {
  if (typeof window === 'undefined') return null;
  const w = window as TauriWindow;
  return w.__TAURI__?.core ?? null;
}

export async function loadDesktopSettings(): Promise<DesktopSettings> {
  const tauri = getTauri();
  if (!tauri) {
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
    const content = await tauri.invoke<string>('read_file', { path: SETTINGS_PATH });
    const parsed = JSON.parse(content) as Partial<DesktopSettings>;
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveDesktopSettings(settings: DesktopSettings): Promise<void> {
  const tauri = getTauri();
  if (!tauri) {
    // Web preview mode — fall back to localStorage
    try {
      localStorage.setItem(LOCALSTORAGE_KEY, JSON.stringify(settings));
    } catch {
      // ignore quota errors
    }
    return;
  }

  await tauri.invoke('write_file', {
    path: SETTINGS_PATH,
    content: JSON.stringify(settings, null, 2),
  });
}

export async function updateDesktopSetting<K extends keyof DesktopSettings>(
  key: K,
  value: DesktopSettings[K],
): Promise<void> {
  const settings = await loadDesktopSettings();
  settings[key] = value;
  await saveDesktopSettings(settings);
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
