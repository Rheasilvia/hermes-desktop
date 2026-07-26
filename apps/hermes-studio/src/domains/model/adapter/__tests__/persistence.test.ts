import { describe, it, expect } from 'vitest';
import { MemoryFsAdapter } from '../fs-adapter.js';
import {
  readDesktopJson,
  writeDesktopJsonAtomic,
} from '../persistence.js';
import { DESKTOP_MODELS_FILE, DESKTOP_MODELS_SCHEMA_VERSION } from '../types.js';

describe('persistence', () => {
  it('returns empty file when missing', async () => {
    const fs = new MemoryFsAdapter();
    const data = await readDesktopJson(fs);
    expect(data).toEqual({ version: DESKTOP_MODELS_SCHEMA_VERSION, providers: {} });
  });

  it('round-trips data', async () => {
    const fs = new MemoryFsAdapter();
    const payload = {
      version: 1 as const,
      providers: {
        openai: {
          base_url: 'https://api.openai.com/v1',
          api_key_env: null,
          enabled: true,
          models: { 'gpt-4o': { enabled: true } },
          _meta: { last_modified_at: '2026-04-29T00:00:00Z', is_builtin: true },
        },
      },
    };
    await writeDesktopJsonAtomic(fs, payload);
    const read = await readDesktopJson(fs);
    expect(read).toEqual(payload);
  });

  it('backs up corrupted file and returns empty', async () => {
    const fs = new MemoryFsAdapter();
    await fs.writeText(DESKTOP_MODELS_FILE, '{not json');
    const data = await readDesktopJson(fs);
    expect(data.providers).toEqual({});
    const keys = Array.from(fs.files.keys());
    expect(keys.some(k => k.includes('models.json.broken-'))).toBe(true);
  });

  it('writes via temp file path then rename', async () => {
    const fs = new MemoryFsAdapter();
    let sawTemp = false;
    const origWrite = fs.writeText.bind(fs);
    fs.writeText = async (p, c) => {
      if (p.endsWith('.tmp')) sawTemp = true;
      return origWrite(p, c);
    };
    await writeDesktopJsonAtomic(fs, { version: 1, providers: {} });
    expect(sawTemp).toBe(true);
  });
});
