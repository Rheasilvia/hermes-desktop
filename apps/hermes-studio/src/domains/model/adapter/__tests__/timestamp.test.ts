import { describe, it, expect } from 'vitest';
import { isoToEpoch, isYamlNewer, nowIso } from '../timestamp.js';

describe('timestamp', () => {
  it('isoToEpoch parses ISO 8601 UTC', () => {
    const epoch = isoToEpoch('2026-04-29T00:00:00Z');
    const expected = Math.floor(Date.parse('2026-04-29T00:00:00Z') / 1000);
    expect(epoch).toBe(expected);
    expect(epoch).toBeGreaterThan(0);
  });

  it('isoToEpoch returns 0 for missing/invalid', () => {
    expect(isoToEpoch(undefined)).toBe(0);
    expect(isoToEpoch('garbage')).toBe(0);
  });

  it('isYamlNewer: yaml mtime greater wins', () => {
    const base = isoToEpoch('2026-04-29T00:00:00Z');
    expect(isYamlNewer(base + 1, '2026-04-29T00:00:00Z')).toBe(true);
    expect(isYamlNewer(base - 1, '2026-04-29T00:00:00Z')).toBe(false);
  });

  it('isYamlNewer: tie favors desktop', () => {
    const base = isoToEpoch('2026-04-29T00:00:00Z');
    expect(isYamlNewer(base, '2026-04-29T00:00:00Z')).toBe(false);
  });

  it('nowIso returns ISO Z timestamp', () => {
    const s = nowIso();
    expect(s).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  });
});
