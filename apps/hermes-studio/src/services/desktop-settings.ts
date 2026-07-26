import templateSettings from '@/assets/desktop-settings-template.json';
import { STORAGE_KEYS } from '@/lib/storage-keys.js';
import { getNativeHost } from '@/services/native-host.js';

const SETTINGS_PATH = 'desktop/settings.json';

export interface DesktopSettings {
  theme: 'light' | 'dark';
  language: string;
  fontSize: number;
  reducedMotion: boolean;
  autoSave: boolean;
  confirmDestructive: boolean;
  startupBehavior: 'restore' | 'new';
  showCost: boolean;
  showReasoning: boolean;
}

const DEFAULT_SETTINGS: DesktopSettings = {
  ...(templateSettings as DesktopSettings),
};

function normalizeDesktopSettings(value: unknown): DesktopSettings {
  const source = typeof value === 'object' && value !== null
    ? value as Record<string, unknown>
    : {};
  return {
    theme: source.theme === 'dark' || source.theme === 'light'
      ? source.theme
      : DEFAULT_SETTINGS.theme,
    language: typeof source.language === 'string' ? source.language : DEFAULT_SETTINGS.language,
    fontSize: typeof source.fontSize === 'number' && Number.isFinite(source.fontSize)
      ? source.fontSize
      : DEFAULT_SETTINGS.fontSize,
    reducedMotion: typeof source.reducedMotion === 'boolean'
      ? source.reducedMotion
      : DEFAULT_SETTINGS.reducedMotion,
    autoSave: typeof source.autoSave === 'boolean' ? source.autoSave : DEFAULT_SETTINGS.autoSave,
    confirmDestructive: typeof source.confirmDestructive === 'boolean'
      ? source.confirmDestructive
      : DEFAULT_SETTINGS.confirmDestructive,
    startupBehavior: source.startupBehavior === 'new' || source.startupBehavior === 'restore'
      ? source.startupBehavior
      : DEFAULT_SETTINGS.startupBehavior,
    showCost: typeof source.showCost === 'boolean' ? source.showCost : DEFAULT_SETTINGS.showCost,
    showReasoning: typeof source.showReasoning === 'boolean'
      ? source.showReasoning
      : DEFAULT_SETTINGS.showReasoning,
  };
}

export async function loadDesktopSettings(): Promise<DesktopSettings> {
  const host = getNativeHost();
  if (!host) {
    // Browser preview mode — fall back to the Studio-only storage namespace.
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.desktopSettings);
      if (raw) {
        return normalizeDesktopSettings(JSON.parse(raw));
      }
    } catch {
      // ignore parse errors
    }
    return { ...DEFAULT_SETTINGS };
  }

  try {
    const content = await host.hermesHome.readText(SETTINGS_PATH);
    return normalizeDesktopSettings(JSON.parse(content));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveDesktopSettings(settings: DesktopSettings): Promise<void> {
  const normalized = normalizeDesktopSettings(settings);
  const host = getNativeHost();
  if (!host) {
    // Browser preview mode — fall back to the Studio-only storage namespace.
    try {
      localStorage.setItem(STORAGE_KEYS.desktopSettings, JSON.stringify(normalized));
    } catch {
      // ignore quota errors
    }
    return;
  }

  await host.hermesHome.writeText(SETTINGS_PATH, JSON.stringify(normalized, null, 2));
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
