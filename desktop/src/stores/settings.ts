/**
 * Settings store - manages config loading/saving and active settings tab.
 */

import { createSignal } from 'solid-js';
import type { HermesConfig } from '@/types/index.js';
import { getGateway } from './context.js';
import { api } from '../services/api/router';
import type { Settings } from '../services/api/types';

const [config, setConfig] = createSignal<HermesConfig | null>(null);
const [activeTab, setActiveTab] = createSignal<string>('general');
const [isLoading, setIsLoading] = createSignal(false);
const [error, setError] = createSignal<string | null>(null);
const [isDirty, setIsDirty] = createSignal(false);

export const settingsStore = {
  get config() { return config(); },
  get activeTab() { return activeTab(); },
  get isLoading() { return isLoading(); },
  get error() { return error(); },
  get isDirty() { return isDirty(); },

  setActiveTab(tab: string) {
    setActiveTab(tab);
  },

  async loadConfig(): Promise<void> {
    const gateway = getGateway();
    if (!gateway) {
      setConfig(null);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const cfg = await gateway.config.get();
      setConfig(cfg);
      setIsDirty(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load config');
    } finally {
      setIsLoading(false);
    }
  },

  async saveConfig(key: string, value: unknown): Promise<boolean> {
    const gateway = getGateway();
    if (!gateway) return false;
    setIsLoading(true);
    setError(null);
    try {
      await gateway.config.set({ key, value, source: 'desktop' });
      await this.loadConfig();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save config');
      return false;
    } finally {
      setIsLoading(false);
    }
  },

  async saveConfigSection(section: string, values: Record<string, unknown>): Promise<boolean> {
    const gateway = getGateway();
    if (!gateway) return false;
    setIsLoading(true);
    setError(null);
    try {
      for (const [key, value] of Object.entries(values)) {
        await gateway.config.set({ key: `${section}.${key}`, value, source: 'desktop' });
      }
      await this.loadConfig();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save config section');
      return false;
    } finally {
      setIsLoading(false);
    }
  },

  markDirty() {
    setIsDirty(true);
  },

  clearError() {
    setError(null);
  },
};

const DEFAULT: Settings = { schema_version: 1, ui: {} };

export function createSettingsStore() {
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

export const newSettingsStore = createSettingsStore();
