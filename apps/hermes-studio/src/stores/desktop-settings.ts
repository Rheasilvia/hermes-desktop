/**
 * Desktop-local settings store.
 *
 * This store owns SQLite-backed Tauri UI preferences only. Hermes runtime
 * configuration belongs in config.ts.
 */

import { createSignal } from 'solid-js';
import { api } from '../services/api/router';
import type { Settings } from '../services/api/types';

const DEFAULT: Settings = {
  schema_version: 1,
  ui: {},
  desktop_sandbox: {
    mode: 'workspace-write',
    network_access: 'restricted',
  },
};

export function createDesktopSettingsStore() {
  const [settings, setSettings] = createSignal<Settings>(DEFAULT);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<Error | null>(null);
  let mutationVersion = 0;

  const load = async () => {
    const versionAtStart = mutationVersion;
    setLoading(true);
    setError(null);
    try {
      const next = await api.settings().get();
      if (versionAtStart === mutationVersion) {
        setSettings(next);
      }
    } catch (e) {
      setError(e as Error);
    } finally {
      setLoading(false);
    }
  };

  const save = async (next: Settings) => {
    const version = ++mutationVersion;
    const prev = settings();
    setSettings(next);
    try {
      const echoed = await api.settings().put(next);
      if (version === mutationVersion) {
        setSettings(echoed);
      }
    } catch (e) {
      if (version === mutationVersion) {
        setSettings(prev);
      }
      throw e;
    }
  };

  const saveDesktopSandbox = async (desktop_sandbox: Settings['desktop_sandbox']) => {
    const version = ++mutationVersion;
    const prev = settings();
    setSettings({ ...prev, desktop_sandbox });
    try {
      const latest = await api.settings().get();
      const echoed = await api.settings().put({
        ...latest,
        desktop_sandbox,
      });
      if (version === mutationVersion) {
        setSettings(echoed);
      }
    } catch (e) {
      if (version === mutationVersion) {
        setSettings(prev);
      }
      throw e;
    }
  };

  return { settings, loading, error, load, save, saveDesktopSandbox };
}

export const desktopSettingsStore = createDesktopSettingsStore();
