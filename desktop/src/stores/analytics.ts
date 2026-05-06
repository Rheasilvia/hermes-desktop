import { createSignal } from 'solid-js';
import { api } from '@/services/api/index.js';
import type { ModelAnalyticsResponse, AnalyticsPeriod } from '@/types/analytics.js';

export interface AnalyticsStore {
  data: () => ModelAnalyticsResponse | null;
  isLoading: () => boolean;
  error: () => string | null;
  period: () => AnalyticsPeriod;
  /** Fetch analytics data. Callers must call load() explicitly after setPeriod(). */
  load: (days?: AnalyticsPeriod) => Promise<void>;
  /** Updates the period signal. Does NOT trigger a reload — call load() separately. */
  setPeriod: (days: AnalyticsPeriod) => void;
}

export function createAnalyticsStore(): AnalyticsStore {
  const [data, setData] = createSignal<ModelAnalyticsResponse | null>(null);
  const [isLoading, setIsLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [period, setPeriodSignal] = createSignal<AnalyticsPeriod>(30);
  let loadSeq = 0;

  async function load(days?: AnalyticsPeriod): Promise<void> {
    const seq = ++loadSeq;
    const d = days ?? period();
    setIsLoading(true);
    setError(null);
    try {
      const result = await api.analytics().getModelAnalytics(d);
      if (seq !== loadSeq) return;
      setData(result);
    } catch (e) {
      if (seq !== loadSeq) return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (seq === loadSeq) setIsLoading(false);
    }
  }

  function setPeriod(days: AnalyticsPeriod): void {
    setPeriodSignal(days);
  }

  return { data, isLoading, error, period, load, setPeriod };
}

export const analyticsStore = createAnalyticsStore();
