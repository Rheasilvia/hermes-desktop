import type { ProviderEntry } from '@/types/index.js';
import type { FallbackTarget } from './types.js';

export function filterEnabledForRuntime(providers: ProviderEntry[]): ProviderEntry[] {
  return providers
    .filter(p => p.enabled !== false)
    .map(p => ({
      ...p,
      models: (p.models ?? []).filter(m => m.enabled !== false),
    }))
    .filter(p => (p.models?.length ?? 0) > 0);
}

export function computeFallbackModel(
  providers: ProviderEntry[],
  disabledProvider: string,
  disabledModel: string,
): FallbackTarget | null {
  for (const p of providers) {
    if (p.enabled === false) continue;
    if (p.name !== disabledProvider) continue;
    for (const m of p.models ?? []) {
      if (m.enabled === false) continue;
      if (m.name === disabledModel) continue;
      return { provider: p.name, model: m.name };
    }
  }
  for (const p of providers) {
    if (p.enabled === false) continue;
    if (p.name === disabledProvider) continue;
    for (const m of p.models ?? []) {
      if (m.enabled === false) continue;
      return { provider: p.name, model: m.name };
    }
  }
  return null;
}
