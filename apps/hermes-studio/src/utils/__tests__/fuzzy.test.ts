import { describe, test, expect } from 'vitest';
import { fuzzyMatch, fuzzyScore, highlightMatch } from '../fuzzy.js';

describe('fuzzyMatch', () => {
  test('matches subsequences, rejects out-of-order', () => {
    expect(fuzzyMatch('nw', 'new')).toBe(true);
    expect(fuzzyMatch('new', 'new')).toBe(true);
    expect(fuzzyMatch('wn', 'new')).toBe(false);
    expect(fuzzyMatch('xyz', 'new')).toBe(false);
  });
});

describe('fuzzyScore', () => {
  test('ranks exact > prefix > substring > subsequence > no-match', () => {
    const exact = fuzzyScore('new', 'new');
    const prefix = fuzzyScore('new', 'newish');
    const substring = fuzzyScore('ew', 'anew');
    const subseq = fuzzyScore('nw', 'now-or-when'); // n…w not contiguous
    expect(exact).toBeGreaterThan(prefix);
    expect(prefix).toBeGreaterThan(substring);
    expect(substring).toBeGreaterThan(subseq);
    expect(fuzzyScore('xyz', 'new')).toBe(-Infinity);
  });

  test('empty query is neutral (0)', () => {
    expect(fuzzyScore('', 'anything')).toBe(0);
  });
});

describe('highlightMatch', () => {
  test('wraps matched chars in <mark>', () => {
    expect(highlightMatch('nw', 'new')).toBe('<mark>n</mark>e<mark>w</mark>');
    expect(highlightMatch('', 'new')).toBe('new');
  });
});
