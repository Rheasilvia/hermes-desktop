import type { AnalyticsTransport } from '../http/analytics';
import type { ModelAnalyticsResponse } from '@/types/analytics';

const EMPTY_RESPONSE: ModelAnalyticsResponse = {
  models: [],
  totals: {
    total_sessions: 0,
    total_input_tokens: 0,
    total_output_tokens: 0,
    total_tokens: 0,
    total_cost_usd: 0,
  },
  period_days: 30,
  generated_at: new Date().toISOString(),
};

export function makeMockAnalyticsTransport(): AnalyticsTransport {
  return {
    getModelAnalytics: async (_days = 30) => EMPTY_RESPONSE,
  };
}
