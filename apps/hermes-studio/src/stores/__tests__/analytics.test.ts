import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/services/api/index.js', () => ({
  api: {
    analytics: vi.fn().mockReturnValue({
      getModelAnalytics: vi.fn().mockResolvedValue({
        models: [],
        totals: {
          total_sessions: 0,
          total_input_tokens: 0,
          total_output_tokens: 0,
          total_tokens: 0,
          total_cost_usd: 0,
        },
        period_days: 30,
        generated_at: '2026-05-06T00:00:00Z',
      }),
    }),
  },
}));

describe('analyticsStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('initialises with empty state', async () => {
    const { createAnalyticsStore } = await import('../analytics.js');
    const store = createAnalyticsStore();
    expect(store.data()).toBeNull();
    expect(store.isLoading()).toBe(false);
    expect(store.period()).toBe(30);
  });

  it('load sets isLoading then populates data', async () => {
    const { createAnalyticsStore } = await import('../analytics.js');
    const store = createAnalyticsStore();
    const promise = store.load();
    expect(store.isLoading()).toBe(true);
    await promise;
    expect(store.isLoading()).toBe(false);
    expect(store.data()).not.toBeNull();
  });

  it('setPeriod updates period signal', async () => {
    const { createAnalyticsStore } = await import('../analytics.js');
    const store = createAnalyticsStore();
    store.setPeriod(7);
    expect(store.period()).toBe(7);
  });
});
