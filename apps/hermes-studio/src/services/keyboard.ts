/**
 * Global keyboard shortcut registry.
 * Handles app-level keyboard shortcuts with platform-aware modifier keys.
 */

import { createSignal } from 'solid-js';

export interface KeyboardCallbacks {
  onToggleSidebar: () => void;
  onNavigate: (route: string) => void;
  onNewSession: () => void;
  onToggleCommandPalette: () => void;
}

const [commandPaletteOpen, setCommandPaletteOpen] = createSignal(false);

export { commandPaletteOpen };

export function isMac(): boolean {
  if (typeof navigator === 'undefined') return false;
  const platform = navigator.platform ?? '';
  return platform.includes('Mac') || navigator.userAgent.includes('Mac');
}

let currentCallbacks: KeyboardCallbacks | null = null;
let currentHandler: ((e: KeyboardEvent) => void) | null = null;

export function initKeyboardShortcuts(callbacks: KeyboardCallbacks): void {
  currentCallbacks = callbacks;

  const handler = (e: KeyboardEvent) => {
    const mod = isMac() ? e.metaKey : e.ctrlKey;

    if (mod && e.key === 'k') {
      e.preventDefault();
      setCommandPaletteOpen(!commandPaletteOpen());
      currentCallbacks?.onToggleCommandPalette();
      return;
    }

    if (e.key === 'Escape' && commandPaletteOpen()) {
      e.preventDefault();
      setCommandPaletteOpen(false);
      currentCallbacks?.onToggleCommandPalette();
      return;
    }

    if (!mod) return;

    if (e.key === 'n') {
      e.preventDefault();
      currentCallbacks?.onNewSession();
      return;
    }

    if (e.key === ',') {
      e.preventDefault();
      currentCallbacks?.onNavigate('/settings/general');
      return;
    }

    if (e.key === '\\') {
      e.preventDefault();
      currentCallbacks?.onToggleSidebar();
      return;
    }

    if (e.key >= '1' && e.key <= '9') {
      e.preventDefault();
      const routes: Record<string, string> = {
        '1': '/',
        '2': '/settings/sessions',
        '3': '/settings/memory',
        '4': '/settings/model',
        '5': '/settings/skills',
        '6': '/settings/plugins',
        '7': '/settings/gateway',
        '8': '/settings/cron',
        '9': '/settings/general',
      };
      const route = routes[e.key];
      if (route) {
        currentCallbacks?.onNavigate(route);
      }
      return;
    }
  };

  currentHandler = handler;
  document.addEventListener('keydown', handler);
}

export function destroyKeyboardShortcuts(): void {
  if (currentHandler) {
    document.removeEventListener('keydown', currentHandler);
    currentHandler = null;
  }
  currentCallbacks = null;
}

export function closeCommandPalette(): void {
  setCommandPaletteOpen(false);
}

export function openCommandPalette(): void {
  setCommandPaletteOpen(true);
}
