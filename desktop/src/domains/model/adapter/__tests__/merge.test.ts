import { describe, it, expect } from 'vitest';
import { mergeProviders } from '../merge.js';
import type { DesktopModelsFile } from '../types.js';
import type { ProviderEntry } from '@/types/index.js';

const yamlOpenAI: ProviderEntry = {
  name: 'openai',
  display_name: 'OpenAI',
  base_url: 'https://api.openai.com/v1',
  api_key: 'sk-yaml',
  models: [
    { name: 'gpt-4o' },
    { name: 'gpt-4o-mini' },
  ],
};

function emptyDesktop(): DesktopModelsFile {
  return { version: 1, providers: {} };
}

describe('mergeProviders', () => {
  it('yaml-only provider gets default desktop fields', () => {
    const out = mergeProviders([yamlOpenAI], emptyDesktop(), 1000, ['openai']);
    expect(out).toHaveLength(1);
    expect(out[0].enabled).toBe(true);
    expect(out[0].is_builtin).toBe(true);
    expect(out[0].models?.every(m => m.enabled === true)).toBe(true);
  });

  it('orphan in desktop.json is dropped', () => {
    const desktop: DesktopModelsFile = {
      version: 1,
      providers: {
        ghost: {
          enabled: true,
          models: { phantom: { enabled: false } },
          _meta: { last_modified_at: '2026-04-29T00:00:00Z', is_builtin: false },
        },
      },
    };
    const out = mergeProviders([yamlOpenAI], desktop, 1000, ['openai']);
    expect(out.find(p => p.name === 'ghost')).toBeUndefined();
  });

  it('yaml mtime newer — shared fields from yaml, desktop-only preserved', () => {
    const desktop: DesktopModelsFile = {
      version: 1,
      providers: {
        openai: {
          base_url: 'https://stale-mirror',
          api_key: 'sk-stale',
          enabled: false,
          models: { 'gpt-4o': { enabled: false } },
          _meta: { last_modified_at: '2020-01-01T00:00:00Z', is_builtin: true },
        },
      },
    };
    const yamlMtime = Math.floor(Date.parse('2026-04-29T00:00:00Z') / 1000);
    const [merged] = mergeProviders([yamlOpenAI], desktop, yamlMtime, ['openai']);
    expect(merged.api_key).toBe('sk-yaml');
    expect(merged.enabled).toBe(false);
    expect(merged.models!.find(m => m.name === 'gpt-4o')!.enabled).toBe(false);
  });

  it('desktop mtime newer — shared fields from desktop mirror', () => {
    const desktop: DesktopModelsFile = {
      version: 1,
      providers: {
        openai: {
          base_url: 'https://desktop-edited',
          api_key: 'sk-desktop',
          enabled: true,
          models: {},
          _meta: { last_modified_at: '2099-01-01T00:00:00Z', is_builtin: true },
        },
      },
    };
    const [merged] = mergeProviders([yamlOpenAI], desktop, 1000, ['openai']);
    expect(merged.api_key).toBe('sk-desktop');
    expect(merged.base_url).toBe('https://desktop-edited');
  });

  it('tie favors desktop', () => {
    const desktop: DesktopModelsFile = {
      version: 1,
      providers: {
        openai: {
          base_url: 'https://desktop-mirror',
          api_key: 'sk-desktop',
          enabled: true,
          models: {},
          _meta: { last_modified_at: '2026-04-29T00:00:00Z', is_builtin: true },
        },
      },
    };
    const yamlMtime = Math.floor(Date.parse('2026-04-29T00:00:00Z') / 1000);
    const [merged] = mergeProviders([yamlOpenAI], desktop, yamlMtime, ['openai']);
    expect(merged.api_key).toBe('sk-desktop');
  });

  it('unknown desktop model entry does not appear in merged models', () => {
    const desktop: DesktopModelsFile = {
      version: 1,
      providers: {
        openai: {
          enabled: true,
          models: { 'gpt-removed': { enabled: false } },
          _meta: { last_modified_at: '2026-04-29T00:00:00Z', is_builtin: true },
        },
      },
    };
    const [merged] = mergeProviders([yamlOpenAI], desktop, 1000, ['openai']);
    expect(merged.models!.find(m => m.name === 'gpt-removed')).toBeUndefined();
  });
});
