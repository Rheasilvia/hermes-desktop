import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModelTransport } from '../../services/api/transports/http/model';

let testApi: typeof import('../../services/api/router').api;

beforeEach(async () => {
  vi.resetModules();
  localStorage.clear();
  ({ api: testApi } = await import('../../services/api/router'));
  testApi.register('model', {
    listProviders: vi.fn().mockResolvedValue({
      items: [
        {
          id: 'provider_test_anthropic',
          name: 'Anthropic',
          auth: 'api_key',
          models: [{ id: 'claude-sonnet-4', context_window: 200000 }],
          desktop: { visible: true },
        },
      ],
      generated_at: '2026-05-05T09:00:00Z',
    }),
    getCatalog: vi.fn(),
    getActiveModel: vi.fn().mockResolvedValue({ provider: null, model: null }),
    setActiveModel: vi.fn(),
    revealProviderApiKey: vi.fn(),
  } satisfies ModelTransport);
});

describe('models store', () => {
  it('load() populates providers from api', async () => {
    const { createModelsStore } = await import('../models');
    const s = createModelsStore();
    await s.load();
    expect(s.providers().length).toBe(1);
    expect(s.providers()[0].name).toBe('provider_test_anthropic');
    expect(s.providers()[0].display_name).toBe('Anthropic');
    expect(s.providers()[0].is_builtin).toBe(true);
    expect(s.providers()[0].enabled).toBe(true);
    expect(s.providers()[0].models?.length).toBe(1);
    expect(s.providers()[0].models?.[0].name).toBe('claude-sonnet-4');
    expect(s.providers()[0].models?.[0].context_length).toBe(200000);
    expect(s.hasLoaded()).toBe(true);
  });

  it('does not report empty before the first real load finishes', async () => {
    let resolveProviders!: (value: Awaited<ReturnType<ModelTransport['listProviders']>>) => void;
    const pendingProviders = new Promise<Awaited<ReturnType<ModelTransport['listProviders']>>>((resolve) => {
      resolveProviders = resolve;
    });
    testApi.register('model', {
      listProviders: vi.fn().mockReturnValue(pendingProviders),
      getCatalog: vi.fn(),
      getActiveModel: vi.fn().mockResolvedValue({ provider: null, model: null }),
      setActiveModel: vi.fn(),
      revealProviderApiKey: vi.fn(),
    } satisfies ModelTransport);

    const { createModelsStore } = await import('../models');
    const s = createModelsStore();
    const loadPromise = s.load();

    expect(s.loading()).toBe(true);
    expect(s.hasLoaded()).toBe(false);
    expect(s.providers().length).toBe(0);

    resolveProviders({ items: [], generated_at: '2026-05-05T09:00:00Z' });
    await loadPromise;

    expect(s.loading()).toBe(false);
    expect(s.hasLoaded()).toBe(true);
    expect(s.providers().length).toBe(0);
  });

  it('hydrates cached real providers immediately while refresh is pending', async () => {
    localStorage.setItem(
      'hermes.desktop.model.providers.v1',
      JSON.stringify([
        {
          id: 'provider_cached_openai',
          name: 'OpenAI',
          auth: 'api_key',
          models: [{ id: 'gpt-5', context_window: 128000 }],
          desktop: { visible: true },
        },
      ]),
    );

    const { createModelsStore } = await import('../models');
    const s = createModelsStore();

    expect(s.hasLoaded()).toBe(true);
    expect(s.loading()).toBe(false);
    expect(s.providers().length).toBe(1);
    expect(s.providers()[0].display_name).toBe('OpenAI');
  });
});

describe('loadActive', () => {
  it('calls getActiveModel and hydrates the store on success', async () => {
    const mockGetActiveModel = vi.fn().mockResolvedValue({
      provider: 'anthropic',
      model: 'claude-sonnet-4',
    });
    testApi.register('model', {
      listProviders: vi.fn().mockResolvedValue({ items: [], generated_at: '' }),
      getCatalog: vi.fn(),
      getActiveModel: mockGetActiveModel,
      setActiveModel: vi.fn(),
      revealProviderApiKey: vi.fn(),
    } satisfies ModelTransport);

    const { createModelsStore, modelStore } = await import('../models');
    const s = createModelsStore();
    await s.loadActive();

    expect(mockGetActiveModel).toHaveBeenCalledOnce();
    expect(modelStore.activeProvider).toBe('anthropic');
    expect(modelStore.activeModel).toBe('claude-sonnet-4');
  });

  it('hydrates with nulls when getActiveModel rejects', async () => {
    const mockGetActiveModel = vi.fn().mockRejectedValue(new Error('Network error'));
    testApi.register('model', {
      listProviders: vi.fn().mockResolvedValue({ items: [], generated_at: '' }),
      getCatalog: vi.fn(),
      getActiveModel: mockGetActiveModel,
      setActiveModel: vi.fn(),
      revealProviderApiKey: vi.fn(),
    } satisfies ModelTransport);

    const { createModelsStore, modelStore } = await import('../models');
    const s = createModelsStore();
    await s.loadActive();

    expect(mockGetActiveModel).toHaveBeenCalledOnce();
    expect(modelStore.activeProvider).toBeNull();
    expect(modelStore.activeModel).toBeNull();
  });
});
