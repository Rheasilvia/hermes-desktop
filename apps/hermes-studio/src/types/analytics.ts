export interface ModelCapabilities {
  vision: boolean;
  function_calling: boolean;
  streaming: boolean;
}

export interface ModelUsageStat {
  provider: string;
  model: string;
  display_name?: string | null;
  session_count: number;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  cost_usd: number;
  last_used_at?: string | null;
  capabilities: ModelCapabilities;
}

export interface UsageTotals {
  total_sessions: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_tokens: number;
  total_cost_usd: number;
}

export interface ModelAnalyticsResponse {
  models: ModelUsageStat[];
  totals: UsageTotals;
  period_days: number;
  generated_at: string;
}

export type AnalyticsPeriod = 7 | 30 | 90;
