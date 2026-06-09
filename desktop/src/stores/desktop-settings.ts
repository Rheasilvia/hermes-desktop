/**
 * Desktop-local settings store.
 *
 * This store owns SQLite-backed Tauri UI preferences only. Hermes runtime
 * configuration belongs in config.ts.
 */

import { createSignal } from 'solid-js';
import { api } from '../services/api/router';
import type { Settings } from '../services/api/types';

const DEFAULT: Settings = { schema_version: 1, ui: {} };

export function createDesktopSettingsStore() {
  const [settings, setSettings] = createSignal<Settings>(DEFAULT);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<Error | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setSettings(await api.settings().get());
    } catch (e) {
      setError(e as Error);
    } finally {
      setLoading(false);
    }
  };

  const save = async (next: Settings) => {
    const prev = settings();
    setSettings(next);
    try {
      const echoed = await api.settings().put(next);
      setSettings(echoed);
    } catch (e) {
      setSettings(prev);
      throw e;
    }
  };

  return { settings, loading, error, load, save };
}

export const desktopSettingsStore = createDesktopSettingsStore();
