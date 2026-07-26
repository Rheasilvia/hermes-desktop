import type { ProviderEntry } from '@/types/index.js';

export function sortProviders(providers: ProviderEntry[]): ProviderEntry[] {
  const cmp = (a: ProviderEntry, b: ProviderEntry): number => {
    const ab = a.is_builtin ? 0 : 1;
    const bb = b.is_builtin ? 0 : 1;
    if (ab !== bb) return ab - bb;
    const an = (a.display_name ?? a.name).toLowerCase();
    const bn = (b.display_name ?? b.name).toLowerCase();
    return an < bn ? -1 : an > bn ? 1 : 0;
  };
  return [...providers].sort(cmp);
}
