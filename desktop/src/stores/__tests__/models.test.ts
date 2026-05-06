import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../services/api/router';
import type { ModelTransport } from '../../services/api/transports/http/model';

beforeEach(() => {
  api.register('model', {
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
  } satisfies ModelTransport);
});

describe('models store', () => {
  it('load() populates providers from api', async () => {
    const { createModelsStore } = await import('../models');
    const s = createModelsStore();
    await s.load();
    expect(s.providers().length).toBe(1);
    expect(s.providers()[0].name).toBe('Anthropic');
    expect(s.providers()[0].is_builtin).toBe(true);
    expect(s.providers()[0].enabled).toBe(true);
    expect(s.providers()[0].models?.length).toBe(1);
    expect(s.providers()[0].models?.[0].name).toBe('claude-sonnet-4');
    expect(s.providers()[0].models?.[0].context_length).toBe(200000);
  });
});

describe('loadActive', () => {
  it('calls getActiveModel and hydrates the store on success', async () => {
    const mockGetActiveModel = vi.fn().mockResolvedValue({
      provider: 'anthropic',
      model: 'claude-sonnet-4',
    });
    api.register('model', {
      listProviders: vi.fn().mockResolvedValue({ items: [], generated_at: '' }),
      getCatalog: vi.fn(),
      getActiveModel: mockGetActiveModel,
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
    api.register('model', {
      listProviders: vi.fn().mockResolvedValue({ items: [], generated_at: '' }),
      getCatalog: vi.fn(),
      getActiveModel: mockGetActiveModel,
    } satisfies ModelTransport);

    const { createModelsStore, modelStore } = await import('../models');
    const s = createModelsStore();
    await s.loadActive();

    expect(mockGetActiveModel).toHaveBeenCalledOnce();
    expect(modelStore.activeProvider).toBeNull();
    expect(modelStore.activeModel).toBeNull();
  });
});
