import { describe, test, expect } from 'vitest';
import { mapCommandResult } from '../http-adapter.js';

/**
 * The backend emits snake_case `card_type` + `message`; the frontend union uses
 * `cardType` + `text`. mapCommandResult bridges them — the regression that made
 * every card command render an empty "No output." card.
 */
describe('mapCommandResult', () => {
  test('maps a card result: card_type → cardType, message → text', () => {
    const r = mapCommandResult({ kind: 'card', card_type: 'output', message: 'hello' });
    expect(r).toEqual({ kind: 'card', cardType: 'output', text: 'hello', name: undefined });
  });

  test('a live-data card with no message has undefined text (not empty string)', () => {
    const r = mapCommandResult({ kind: 'card', card_type: 'tools' });
    expect(r.kind).toBe('card');
    if (r.kind === 'card') {
      expect(r.cardType).toBe('tools');
      expect(r.text).toBeUndefined();
    }
  });

  test('passes through message + name for output/skill/unsupported/error', () => {
    expect(mapCommandResult({ kind: 'output', message: 'done' })).toEqual({
      kind: 'output',
      message: 'done',
      name: undefined,
    });
    expect(mapCommandResult({ kind: 'skill', message: 'PROMPT', name: 'arxiv' })).toEqual({
      kind: 'skill',
      message: 'PROMPT',
      name: 'arxiv',
    });
  });

  test('maps an action result', () => {
    expect(mapCommandResult({ kind: 'action', action: 'title', message: 'My session' })).toEqual({
      kind: 'action',
      action: 'title',
      message: 'My session',
      name: undefined,
    });
  });

  test('missing message defaults to empty string for non-card kinds', () => {
    const r = mapCommandResult({ kind: 'error' });
    expect(r).toEqual({ kind: 'error', message: '', name: undefined });
  });
});
