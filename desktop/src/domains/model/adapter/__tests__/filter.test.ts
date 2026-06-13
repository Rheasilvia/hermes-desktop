import { describe, it, expect } from 'vitest';
import { filterEnabledForRuntime, computeFallbackModel } from '../filter.js';
import type { ProviderEntry } from '@/types/index.js';

const mk = (
  name: string,
  enabled: boolean,
  models: { name: string; enabled: boolean }[],
): ProviderEntry => ({ name, enabled, models, is_builtin: true });

describe('filterEnabledForRuntime', () => {
  it('drops disabled providers and disabled models', () => {
    const out = filterEnabledForRuntime([
      mk('a', true, [{ name: 'm1', enabled: true }, { name: 'm2', enabled: false }]),
      mk('b', false, [{ name: 'm1', enabled: true }]),
    ]);
    expect(out.map(p => p.name)).toEqual(['a']);
    expect(out[0].models?.map(m => m.name)).toEqual(['m1']);
  });
});

describe('computeFallbackModel', () => {
  const providers: ProviderEntry[] = [
    mk('p1', true, [
      { name: 'm1', enabled: true },
      { name: 'm2', enabled: true },
    ]),
    mk('p2', true, [
      { name: 'mx', enabled: true },
    ]),
    mk('p3', false, [
      { name: 'never', enabled: true },
    ]),
  ];

  it('next enabled model in same provider', () => {
    expect(computeFallbackModel(providers, 'p1', 'm1'))
      .toEqual({ provider: 'p1', model: 'm2' });
  });

  it('cross-provider fallback when same-provider exhausted', () => {
    // p2 only has mx; disable mx → must cross to p1
    expect(computeFallbackModel(providers, 'p2', 'mx'))
      .toEqual({ provider: 'p1', model: 'm1' });
  });

  it('returns null when nothing enabled remains', () => {
    expect(computeFallbackModel([
      mk('only', true, [{ name: 'sole', enabled: true }]),
    ], 'only', 'sole')).toBeNull();
  });

  it('skips disabled provider in cross-provider search', () => {
    // Disable p1 completely, then disable mx in p2 → p3 is disabled → null
    const p = [
      mk('p1', false, [{ name: 'm1', enabled: true }]),
      mk('p2', true, [{ name: 'mx', enabled: true }]),
    ];
    expect(computeFallbackModel(p, 'p2', 'mx')).toBeNull();
  });
});
