/**
 * Shared fuzzy-matching helpers for command search (CommandPalette + slash
 * command panel). `fuzzyMatch` is a boolean subsequence test; `fuzzyScore` adds
 * relevance ranking (exact > prefix > contiguous substring > subsequence) so
 * results can be sorted best-first; `highlightMatch` wraps matched chars in
 * <mark> for display.
 */

/** True when every char of `query` appears in `text` in order (subsequence). */
export function fuzzyMatch(query: string, text: string): boolean {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  let qi = 0;
  for (let i = 0; i < t.length && qi < q.length; i++) {
    if (t[i] === q[qi]) qi++;
  }
  return qi === q.length;
}

/**
 * Relevance score of `query` against `text`. Higher is better; `-Infinity` means
 * no match. An empty query scores 0 (neutral — everything "matches"). Tiers,
 * highest first: exact, prefix, contiguous substring, in-order subsequence. A
 * shorter `text` (closer length to the query) is preferred within a tier.
 */
export function fuzzyScore(query: string, text: string): number {
  const q = query.toLowerCase().trim();
  const t = text.toLowerCase();
  if (!q) return 0;

  if (t === q) return 1000;
  if (t.startsWith(q)) return 800 - t.length;

  const idx = t.indexOf(q);
  if (idx !== -1) return 600 - idx - t.length * 0.1;

  // Subsequence: reward contiguous runs, penalise gaps; bail if not a subsequence.
  let qi = 0;
  let score = 0;
  let lastMatch = -2;
  for (let i = 0; i < t.length && qi < q.length; i++) {
    if (t[i] === q[qi]) {
      score += i === lastMatch + 1 ? 4 : 1; // contiguous chars are worth more
      lastMatch = i;
      qi++;
    }
  }
  if (qi !== q.length) return -Infinity;
  return 300 + score - t.length * 0.1;
}

/** Wrap each subsequence-matched char of `text` in `<mark>` (for innerHTML). */
export function highlightMatch(query: string, text: string): string {
  if (!query) return text;
  const q = query.toLowerCase();
  const result: string[] = [];
  let qi = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (qi < q.length && char.toLowerCase() === q[qi]) {
      result.push(`<mark>${char}</mark>`);
      qi++;
    } else {
      result.push(char);
    }
  }
  return result.join('');
}
