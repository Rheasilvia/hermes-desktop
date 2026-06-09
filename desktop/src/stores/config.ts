/**
 * Hermes runtime configuration store.
 *
 * This store owns config.yaml-backed settings. Desktop-local UI preferences
 * belong in desktop-settings.ts.
 */

import { createSignal } from 'solid-js';
import type { HermesConfig } from '@/types/index.js';
import { getGateway } from './context.js';
import { api } from '../services/api/router';
import type { ConfigSchemaResponse } from '../services/api/types';

const [config, setConfig] = createSignal<HermesConfig | null>(null);
const [configSchema, setConfigSchema] = createSignal<ConfigSchemaResponse | null>(null);
const [configMtime, setConfigMtime] = createSignal(0);
const [isLoading, setIsLoading] = createSignal(false);
const [error, setError] = createSignal<string | null>(null);
const [isDirty, setIsDirty] = createSignal(false);

export const configStore = {
  get config() { return config(); },
  get configSchema() { return configSchema(); },
  get configMtime() { return configMtime(); },
  get isLoading() { return isLoading(); },
  get error() { return error(); },
  get isDirty() { return isDirty(); },

  async loadConfig(): Promise<void> {
    const gateway = getGateway();
    if (!gateway) {
      setConfig(null);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const [read, schema] = await Promise.all([
        api.config().get(),
        api.config().schema(),
      ]);
      setConfig(read.config as HermesConfig);
      setConfigMtime(read.mtime);
      setConfigSchema(schema);
      setIsDirty(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      try {
        const cfg = await gateway.config.get();
        setConfig(cfg);
        setConfigMtime(await gateway.config.getMtime());
        setIsDirty(false);
      } catch {
        if (msg.includes('not implemented')) {
          setConfig(null);
          setConfigSchema(null);
        } else {
          setError(msg);
        }
      }
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
