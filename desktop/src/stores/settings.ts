/**
 * Settings store - manages config loading/saving and active settings tab.
 */

import { createSignal } from 'solid-js';
import type { HermesConfig } from '@/types/index.js';
import { getGateway } from './context.js';

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
