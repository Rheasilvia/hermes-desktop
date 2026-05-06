import type { ModelTransport } from '../http/model';
import type { Provider } from '../../types';

const SEED: Provider[] = [
  {
    id: 'provider_test_anthropic',
    name: 'Anthropic',
    auth: 'api_key',
    models: [{ id: 'claude-sonnet-4', context_window: 200000 }],
    desktop: { visible: true },
  },
  {
    id: 'provider_test_openai',
    name: 'OpenAI',
    auth: 'api_key',
    models: [{ id: 'gpt-5', context_window: 128000 }],
    desktop: { visible: true },
  },
];

export function makeMockModelTransport(): ModelTransport {
  return {
    listProviders: async () => ({
      items: SEED.map((p) => ({ ...p, desktop: { ...p.desktop } })),
      generated_at: '2026-05-05T09:00:00Z',
    }),
    getCatalog: async () => ({
      providers: SEED.map((p) => ({ ...p, desktop: { ...p.desktop } })),
      fetched_at: '2026-05-05T09:00:00Z',
    }),
    getActiveModel: async () => ({ provider: null, model: null }),
    setActiveModel: async () => undefined,
  };
}
