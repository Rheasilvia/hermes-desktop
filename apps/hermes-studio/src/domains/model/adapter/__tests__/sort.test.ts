import { describe, it, expect } from 'vitest';
import { sortProviders } from '../sort.js';
import type { ProviderEntry } from '@/types/index.js';

const mk = (name: string, builtin: boolean, dn?: string): ProviderEntry => ({
  name,
  display_name: dn ?? name,
  is_builtin: builtin,
});

describe('sortProviders', () => {
  it('built-in group precedes custom group', () => {
    const out = sortProviders([
      mk('zebra-custom', false),
      mk('OpenAI', true),
    ]);
    expect(out.map(p => p.name)).toEqual(['OpenAI', 'zebra-custom']);
  });

  it('alphabetical (case-insensitive) within group', () => {
    const out = sortProviders([
      mk('openai', true, 'OpenAI'),
      mk('anthropic', true, 'Anthropic'),
      mk('google', true, 'Google'),
    ]);
    expect(out.map(p => p.name)).toEqual(['anthropic', 'google', 'openai']);
  });

  it('mixed groups sort independently', () => {
    const out = sortProviders([
      mk('zCustom', false, 'zCustom'),
      mk('aCustom', false, 'aCustom'),
      mk('zBuiltin', true, 'zBuiltin'),
      mk('aBuiltin', true, 'aBuiltin'),
    ]);
    expect(out.map(p => p.name)).toEqual([
      'aBuiltin', 'zBuiltin', 'aCustom', 'zCustom',
    ]);
  });
});
