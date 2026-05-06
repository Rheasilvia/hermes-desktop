import { createSignal } from 'solid-js';
import { api } from '@/services/api/index.js';
import type { ModelAnalyticsResponse, AnalyticsPeriod } from '@/types/analytics.js';

export interface AnalyticsStore {
  data: () => ModelAnalyticsResponse | null;
  isLoading: () => boolean;
  error: () => string | null;
  period: () => AnalyticsPeriod;
  load: (days?: number) => Promise<void>;
  setPeriod: (days: AnalyticsPeriod) => void;
}

export function createAnalyticsStore(): AnalyticsStore {
  const [data, setData] = createSignal<ModelAnalyticsResponse | null>(null);
  const [isLoading, setIsLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [period, setPeriodSignal] = createSignal<AnalyticsPeriod>(30);

  async function load(days?: number): Promise<void> {
    const d = days ?? period();
    setIsLoading(true);
    setError(null);
    try {
      const result = await api.analytics().getModelAnalytics(d);
      setData(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsLoading(false);
    }
  }

  function setPeriod(days: AnalyticsPeriod): void {
    setPeriodSignal(days);
  }

  return { data, isLoading, error, period, load, setPeriod };
}

export const analyticsStore = createAnalyticsStore();
