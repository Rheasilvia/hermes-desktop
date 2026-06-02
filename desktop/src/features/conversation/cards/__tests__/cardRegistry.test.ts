import { describe, test, expect } from 'vitest';
import { cardRegistry } from '../cardRegistry.js';
import type { CardType } from '@/types/command-card.js';

// Every CardType the backend can emit must have a renderer. The `satisfies`
// clause guards this at compile time; this guards it at runtime too (and fails
// loudly if a type is added to the union but forgotten in the registry).
const ALL_CARD_TYPES: CardType[] = [
  'sessions', 'tools', 'skills', 'cron', 'plugins', 'memory', 'platforms',
  'logs', 'agents', 'usage', 'status', 'model', 'config', 'help',
  'account', 'output', 'notice',
];

describe('cardRegistry', () => {
  test('resolves every CardType to a component with chrome metadata', () => {
    for (const type of ALL_CARD_TYPES) {
      const entry = cardRegistry[type];
      expect(entry, `missing registry entry for "${type}"`).toBeDefined();
      expect(typeof entry.Component).toBe('function');
      expect(entry.icon).toBeTruthy();
      expect(entry.title).toBeTruthy();
    }
  });

  test('has no entries beyond the known CardTypes', () => {
    expect(Object.keys(cardRegistry).sort()).toEqual([...ALL_CARD_TYPES].sort());
  });
});
