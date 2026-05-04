import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ModelAdapter } from '../index.js';
import { MemoryFsAdapter } from '../fs-adapter.js';
import type {
  GatewayAdapter,
  ModelOptionsResult,
  UpsertProviderInput,
  DeleteProviderInput,
  ConfigSetInput,
} from '@/services/gateway/types.js';

function makeGateway(): {
  gw: GatewayAdapter;
  state: {
    providers: ModelOptionsResult['providers'];
    active: { provider: string; model: string };
    mtime: number;
    upserts: UpsertProviderInput[];
    deletes: DeleteProviderInput[];
    sets: ConfigSetInput[];
  };
} {
  const state = {
    providers: [
      {
        name: 'openai',
        display_name: 'OpenAI',
        base_url: 'https://api.openai.com/v1',
        api_key: 'sk-yaml',
        models: [{ name: 'gpt-4o' }, { name: 'gpt-4o-mini' }],
      },
    ] as ModelOptionsResult['providers'],
    active: { provider: 'openai', model: 'gpt-4o' },
    mtime: 1000,
    upserts: [] as UpsertProviderInput[],
    deletes: [] as DeleteProviderInput[],
    sets: [] as ConfigSetInput[],
  };
  const gw = {
    config: {
      get: vi.fn(),
      getMtime: vi.fn(async () => state.mtime),
      set: vi.fn(async (input: ConfigSetInput) => { state.sets.push(input); }),
    },
    model: {
      options: vi.fn(async () => ({
        providers: state.providers, model: state.active.model, provider: state.active.provider,
      })),
    },
    provider: {
      upsert: vi.fn(async (input: UpsertProviderInput) => {
        state.upserts.push(input);
        state.mtime += 1;
        return { name: input.name };
      }),
      delete: vi.fn(async (input: DeleteProviderInput) => {
        state.deletes.push(input);
        state.providers = state.providers.filter(p => p.name !== input.name);
        return { ok: true };
      }),
    },
    on: vi.fn(),
    off: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
    getConnectionState: vi.fn(() => 'connected'),
  } as unknown as GatewayAdapter;
  return { gw, state };
}

describe('ModelAdapter', () => {
  let fs: MemoryFsAdapter;
  beforeEach(() => { fs = new MemoryFsAdapter(); });

  it('loadProviders returns yaml when desktop file is empty', async () => {
    const { gw } = makeGateway();
    const a = new ModelAdapter(gw, fs, ['openai']);
    const out = await a.loadProviders();
    expect(out[0].name).toBe('openai');
    expect(out[0].is_builtin).toBe(true);
    expect(out[0].enabled).toBe(true);
  });

  it('upsertProvider writes gateway then desktop.json', async () => {
    const { gw, state } = makeGateway();
    const a = new ModelAdapter(gw, fs, ['openai']);
    await a.upsertProvider({
      name: 'openai',
      is_builtin: true,
      base_url: 'https://api.openai.com/v1',
      api_key: 'sk-new',
    });
    expect(state.upserts).toHaveLength(1);
    const text = await fs.readText('desktop/models.json');
    expect(text).not.toBeNull();
    const parsed = JSON.parse(text!);
    expect(parsed.providers.openai.api_key).toBe('sk-new');
    expect(parsed.providers.openai._meta.is_builtin).toBe(true);
  });

  it('upsertProvider does NOT touch desktop.json on gateway failure', async () => {
    const { gw } = makeGateway();
    (gw.provider.upsert as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('boom'));
    const a = new ModelAdapter(gw, fs, ['openai']);
    await expect(a.upsertProvider({ name: 'openai', is_builtin: true })).rejects.toThrow('boom');
    expect(await fs.readText('desktop/models.json')).toBeNull();
  });

  it('setProviderEnabled materializes desktop entry on first touch', async () => {
    const { gw } = makeGateway();
    const a = new ModelAdapter(gw, fs, ['openai']);
    await a.loadProviders();
    await a.setProviderEnabled('openai', false);
    const parsed = JSON.parse((await fs.readText('desktop/models.json'))!);
    expect(parsed.providers.openai.enabled).toBe(false);
  });

  it('setActiveModel calls config.set with source=desktop', async () => {
    const { gw, state } = makeGateway();
    const a = new ModelAdapter(gw, fs, ['openai']);
    await a.setActiveModel('openai', 'gpt-4o-mini');
    expect(state.sets).toEqual([
      { key: 'model', value: 'openai/gpt-4o-mini', source: 'desktop' },
    ]);
  });

  it('deleteProvider removes desktop entry after successful gateway call', async () => {
    const { gw } = makeGateway();
    const a = new ModelAdapter(gw, fs, ['openai']);
    await a.upsertProvider({ name: 'openai', is_builtin: true });
    await a.deleteProvider('openai', true);
    const parsed = JSON.parse((await fs.readText('desktop/models.json'))!);
    expect(parsed.providers.openai).toBeUndefined();
  });

  it('orphans cleaned on loadProviders', async () => {
    const { gw } = makeGateway();
    await fs.writeText('desktop/models.json', JSON.stringify({
      version: 1,
      providers: {
        ghost: {
          enabled: true, models: {},
          _meta: { last_modified_at: '2026-04-29T00:00:00Z', is_builtin: false },
        },
      },
    }));
    const a = new ModelAdapter(gw, fs, ['openai']);
    await a.loadProviders();
    await new Promise(r => setTimeout(r, 0));
    const parsed = JSON.parse((await fs.readText('desktop/models.json'))!);
    expect(parsed.providers.ghost).toBeUndefined();
  });
});
