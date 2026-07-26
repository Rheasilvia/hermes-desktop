import type { GatewayAdapter, ConfigSetInput } from '@/services/gateway/types.js';
import type { ProviderEntry } from '@/types/index.js';
import type {
  FsAdapter,
  UpsertInput,
  DesktopProviderRecord,
  SetActiveModelResult,
  FallbackTarget,
} from './types.js';
import { readDesktopJson, writeDesktopJsonAtomic } from './persistence.js';
import { mergeProviders } from './merge.js';
import { sortProviders } from './sort.js';
import { computeFallbackModel } from './filter.js';
import { nowIso } from './timestamp.js';

export class ModelAdapter {
  constructor(
    private gw: GatewayAdapter,
    private fs: FsAdapter,
    private builtInNames: readonly string[],
  ) {}

  async loadProviders(sessionId?: string): Promise<ProviderEntry[]> {
    const [opts, mtime, desktop] = await Promise.all([
      this.gw.model.options(sessionId),
      this.gw.config.getMtime().catch(() => 0),
      readDesktopJson(this.fs),
    ]);
    const merged = mergeProviders(opts.providers, desktop, mtime, this.builtInNames);
    const yamlNames = new Set(opts.providers.map(p => p.name));
    const orphans = Object.keys(desktop.providers).filter(n => !yamlNames.has(n));
    if (orphans.length > 0) {
      const next = { ...desktop, providers: { ...desktop.providers } };
      for (const o of orphans) delete next.providers[o];
      writeDesktopJsonAtomic(this.fs, next).catch(() => undefined);
    }
    return sortProviders(merged);
  }

  async loadActiveModel(sessionId?: string): Promise<{ provider: string; model: string } | null> {
    const opts = await this.gw.model.options(sessionId);
    if (!opts.provider || !opts.model) return null;
    return { provider: opts.provider, model: opts.model };
  }

  async upsertProvider(input: UpsertInput): Promise<void> {
    await this.gw.provider.upsert({ ...input, source: 'desktop' });
    const desktop = await readDesktopJson(this.fs);
    const prev = desktop.providers[input.name];
    const next: DesktopProviderRecord = {
      base_url: input.base_url ?? prev?.base_url,
      api_key: input.api_key ?? prev?.api_key,
      api_key_env: input.api_key_env ?? prev?.api_key_env ?? null,
      display_name: input.display_name ?? prev?.display_name,
      enabled: prev?.enabled ?? true,
      models: prev?.models ?? {},
      _meta: { last_modified_at: nowIso(), is_builtin: input.is_builtin },
    };
    desktop.providers[input.name] = next;
    await writeDesktopJsonAtomic(this.fs, desktop);
  }

  async deleteProvider(name: string, isBuiltin: boolean): Promise<void> {
    await this.gw.provider.delete({ name, is_builtin: isBuiltin, source: 'desktop' });
    const desktop = await readDesktopJson(this.fs);
    if (desktop.providers[name]) {
      delete desktop.providers[name];
      await writeDesktopJsonAtomic(this.fs, desktop);
    }
  }

  async setProviderEnabled(name: string, enabled: boolean): Promise<void> {
    const desktop = await readDesktopJson(this.fs);
    const opts = await this.gw.model.options();
    const yamlP = opts.providers.find(p => p.name === name);
    const prev = desktop.providers[name];
    const isBuiltin = this.builtInNames.includes(name);
    desktop.providers[name] = {
      base_url: prev?.base_url ?? yamlP?.base_url,
      api_key: prev?.api_key ?? yamlP?.api_key,
      api_key_env: prev?.api_key_env ?? yamlP?.api_key_env ?? null,
      display_name: prev?.display_name ?? yamlP?.display_name,
      enabled,
      models: prev?.models ?? {},
      _meta: { last_modified_at: nowIso(), is_builtin: prev?._meta.is_builtin ?? isBuiltin },
    };
    await writeDesktopJsonAtomic(this.fs, desktop);
  }

  async setModelEnabled(provider: string, model: string, enabled: boolean): Promise<void> {
    const desktop = await readDesktopJson(this.fs);
    const opts = await this.gw.model.options();
    const yamlP = opts.providers.find(p => p.name === provider);
    const prev = desktop.providers[provider];
    const isBuiltin = this.builtInNames.includes(provider);
    const models = { ...(prev?.models ?? {}) };
    models[model] = { enabled };
    desktop.providers[provider] = {
      base_url: prev?.base_url ?? yamlP?.base_url,
      api_key: prev?.api_key ?? yamlP?.api_key,
      api_key_env: prev?.api_key_env ?? yamlP?.api_key_env ?? null,
      display_name: prev?.display_name ?? yamlP?.display_name,
      enabled: prev?.enabled ?? true,
      models,
      _meta: { last_modified_at: nowIso(), is_builtin: prev?._meta.is_builtin ?? isBuiltin },
    };
    await writeDesktopJsonAtomic(this.fs, desktop);
  }

  async setActiveModel(provider: string, model: string): Promise<SetActiveModelResult> {
    const input: ConfigSetInput = {
      key: 'model',
      value: `${provider}/${model}`,
      source: 'desktop',
    };
    await this.gw.config.set(input);
    return {};
  }

  computeFallbackModel(
    providers: ProviderEntry[],
    disabledProvider: string,
    disabledModel: string,
  ): FallbackTarget | null {
    return computeFallbackModel(providers, disabledProvider, disabledModel);
  }
}
