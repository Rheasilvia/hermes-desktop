import type { HttpClient } from '../../http-client';
import type { ModelAnalyticsResponse } from '@/types/analytics.js';

export interface AnalyticsTransport {
  getModelAnalytics(days?: number): Promise<ModelAnalyticsResponse>;
}

export function makeAnalyticsTransport(client: HttpClient): AnalyticsTransport {
  return {
    getModelAnalytics: (days = 30) =>
      client.get<ModelAnalyticsResponse>(
        `/desktop/api/analytics/models?days=${days}`
      ),
  };
}
