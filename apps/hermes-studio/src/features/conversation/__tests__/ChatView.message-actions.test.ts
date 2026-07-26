import { describe, test, expect } from 'vitest';
import {
  isUserTurnBoundary,
  resolveActionablePlanKey,
  resolveEditedSlashCommandResult,
  resolveMessageCopyText,
  resolveMessageEditDraft,
  resolveMessageRestoreDisplayParts,
} from '../ChatView.js';
import type { PlanBlock, RenderedMessage } from '@/types/index.js';

function makeMessage(overrides: Partial<RenderedMessage>): RenderedMessage {
  return {
    id: 1,
    sessionId: 'sess',
    role: 'user',
    blocks: [],
    timestamp: 0,
    tokenCount: null,
    finishReason: null,
    isStreaming: false,
    actions: [],
    toolName: null,
    ...overrides,
  };
}

function makePlan(id: string, isStreaming = false): PlanBlock {
  return {
    type: 'plan',
    id,
    content: '# Plan\n\n- Do the work',
    isStreaming,
  };
}

describe('resolveMessageCopyText', () => {
  test('returns empty string when blocks is empty', () => {
    const msg = makeMessage({ blocks: [] });
    expect(resolveMessageCopyText(msg)).toBe('');
  });

  test('copies plain user message text from blocks', () => {
    const msg = makeMessage({
      role: 'user',
      blocks: [
        { type: 'text', id: '1', content: 'hello world' },
      ],
    });
    expect(resolveMessageCopyText(msg)).toBe('hello world');
  });

  test('copies slash command as compact form, not expanded blocks text', () => {
    const msg = makeMessage({
      role: 'user',
      slashCommand: { command: 'arxiv', args: 'what is RLHF' },
      blocks: [
        { type: 'text', id: '1', content: '[SKILL PREAMBLE] ... huge expanded text ...' },
      ],
    });
    expect(resolveMessageCopyText(msg)).toBe('/arxiv what is RLHF');
  });

  test('copies slash command with no args as /command only', () => {
    const msg = makeMessage({
      role: 'user',
      slashCommand: { command: 'status', args: '' },
      blocks: [{ type: 'text', id: '1', content: 'expanded...' }],
    });
    expect(resolveMessageCopyText(msg)).toBe('/status');
  });

  test('copies assistant message text blocks when no slashCommand is set', () => {
    const msg = makeMessage({
      role: 'assistant',
      blocks: [
        { type: 'text', id: '1', content: 'Here is the answer.' },
        { type: 'text', id: '2', content: 'Second paragraph.' },
      ],
    });
    expect(resolveMessageCopyText(msg)).toBe('Here is the answer.\nSecond paragraph.');
  });

  test('skips non-text blocks (tool_call, reasoning) when copying', () => {
    const msg = makeMessage({
      role: 'assistant',
      blocks: [
        { type: 'tool_call', id: 'tc1', toolId: 'tc1', name: 'bash', status: 'complete', inputPreview: null, outputSummary: null, inlineDiff: null, durationMs: null },
        { type: 'reasoning', id: 'r1', content: 'thinking...', isStreaming: false, tokenCount: null },
        { type: 'text', id: 't1', content: 'Final answer.' },
      ],
    });
    expect(resolveMessageCopyText(msg)).toBe('Final answer.');
  });

  test('skips code blocks when copying assistant message', () => {
    const msg = makeMessage({
      role: 'assistant',
      blocks: [
        { type: 'text', id: 't1', content: 'Here is some code:' },
        { type: 'code', id: 'c1', language: 'python', filename: null, content: 'print("hello")' },
        { type: 'text', id: 't2', content: 'That is all.' },
      ],
    });
    expect(resolveMessageCopyText(msg)).toBe('Here is some code:\nThat is all.');
  });

  test('does not use slash command shortcut for assistant role messages', () => {
    const msg = makeMessage({
      role: 'assistant',
      slashCommand: { command: 'status', args: '' },
      blocks: [{ type: 'text', id: '1', content: 'The status is fine.' }],
    });
    expect(resolveMessageCopyText(msg)).toBe('The status is fine.');
    expect(resolveMessageEditDraft(msg)).toBe('/status');
  });
});

describe('resolveMessageEditDraft', () => {
  test('returns empty string when blocks is empty', () => {
    const msg = makeMessage({ blocks: [] });
    expect(resolveMessageEditDraft(msg)).toBe('');
  });

  test('returns plain text from blocks for a normal user message', () => {
    const msg = makeMessage({
      blocks: [{ type: 'text', id: '1', content: '  hello world  ' }],
    });
    expect(resolveMessageEditDraft(msg)).toBe('hello world');
  });

  test('returns compact slash command form for slash command messages', () => {
    const msg = makeMessage({
      slashCommand: { command: 'review', args: 'my PR' },
      blocks: [{ type: 'text', id: '1', content: '[HUGE EXPANDED SKILL TEXT]' }],
    });
    expect(resolveMessageEditDraft(msg)).toBe('/review my PR');
  });

  test('returns /command only when args is empty for slash commands', () => {
    const msg = makeMessage({
      slashCommand: { command: 'help', args: '' },
      blocks: [{ type: 'text', id: '1', content: 'expanded...' }],
    });
    expect(resolveMessageEditDraft(msg)).toBe('/help');
  });

  test('joins multiple text blocks with newline and trims the result', () => {
    const msg = makeMessage({
      blocks: [
        { type: 'text', id: '1', content: '  first  ' },
        { type: 'text', id: '2', content: '  second  ' },
      ],
    });
    expect(resolveMessageEditDraft(msg)).toBe('first  \n  second');
  });
});

describe('resolveMessageRestoreDisplayParts', () => {
  test('preserves persisted file refs while replacing the editable text', () => {
    const msg = makeMessage({
      displayParts: [
        {
          type: 'file_ref',
          refText: '@file:src/app.ts',
          name: 'app.ts',
          anchor: 'File 1',
        },
        { type: 'text', text: 'Explain this file' },
      ],
    });

    const parts = resolveMessageRestoreDisplayParts(msg, '[File 1: app.ts] Explain this file with more detail');

    expect(parts).toEqual([
      expect.objectContaining({ type: 'file_ref', refText: '@file:src/app.ts', anchor: 'File 1' }),
      { type: 'text', text: 'Explain this file with more detail' },
    ]);
  });

  test('returns undefined for messages without file refs', () => {
    const msg = makeMessage({
      displayParts: [{ type: 'text', text: 'plain message' }],
    });

    expect(resolveMessageRestoreDisplayParts(msg, 'plain message')).toBeUndefined();
  });
});

describe('resolveEditedSlashCommandResult', () => {
  test('allows skill results and preserves compact slash display metadata', () => {
    expect(resolveEditedSlashCommandResult('review', 'my PR', {
      kind: 'skill',
      message: 'expanded review prompt',
    })).toEqual({
      kind: 'prompt',
      text: 'expanded review prompt',
      display: {
        text: '/review my PR',
        slashCommand: { command: 'review', args: 'my PR' },
      },
    });
  });

  test('allows send results as plain prompt text', () => {
    expect(resolveEditedSlashCommandResult('ask', '', {
      kind: 'send',
      message: 'send this prompt',
    })).toEqual({
      kind: 'prompt',
      text: 'send this prompt',
    });
  });

  test('blocks action and card results before rewind', () => {
    expect(resolveEditedSlashCommandResult('new', '', { kind: 'action', action: 'new' })).toMatchObject({
      kind: 'blocked',
    });
    expect(resolveEditedSlashCommandResult('help', '', { kind: 'card', cardType: 'notice', text: 'Help card' })).toEqual({
      kind: 'blocked',
      message: 'Help card',
    });
  });
});

describe('resolveActionablePlanKey', () => {
  test('returns latest completed plan key when the final message is an assistant plan', () => {
    const messages = [
      makeMessage({ id: 1, role: 'user', blocks: [{ type: 'text', id: 'u1', content: 'plan this' }] }),
      makeMessage({ id: 2, role: 'assistant', blocks: [makePlan('plan_1')] }),
    ];

    expect(resolveActionablePlanKey(messages, false)).toEqual({ messageId: 2, blockId: 'plan_1' });
  });

  test('returns null when a user message follows the latest completed plan', () => {
    const messages = [
      makeMessage({ id: 1, role: 'assistant', blocks: [makePlan('plan_1')] }),
      makeMessage({ id: 2, role: 'user', blocks: [{ type: 'text', id: 'u1', content: 'change it' }] }),
    ];

    expect(resolveActionablePlanKey(messages, false)).toBeNull();
  });

  test('returns null when a later assistant message has no completed plan', () => {
    const messages = [
      makeMessage({ id: 1, role: 'assistant', blocks: [makePlan('plan_1')] }),
      makeMessage({ id: 2, role: 'assistant', blocks: [{ type: 'text', id: 't1', content: 'Done.' }] }),
    ];

    expect(resolveActionablePlanKey(messages, false)).toBeNull();
  });

  test('returns null while a turn is streaming', () => {
    const messages = [
      makeMessage({ id: 1, role: 'assistant', blocks: [makePlan('plan_1')] }),
    ];

    expect(resolveActionablePlanKey(messages, true)).toBeNull();
  });
});

describe('isUserTurnBoundary', () => {
  test('returns true for a user message after an assistant response', () => {
    const messages = [
      makeMessage({ id: 1, role: 'assistant', blocks: [{ type: 'text', id: 'a1', content: 'Answer.' }] }),
      makeMessage({ id: 2, role: 'user', blocks: [{ type: 'text', id: 'u1', content: 'Next request.' }] }),
    ];

    expect(isUserTurnBoundary(messages, 1, false)).toBe(true);
  });

  test('returns false for the first message and non assistant-to-user transitions', () => {
    const messages = [
      makeMessage({ id: 1, role: 'user', blocks: [{ type: 'text', id: 'u1', content: 'First.' }] }),
      makeMessage({ id: 2, role: 'user', blocks: [{ type: 'text', id: 'u2', content: 'Follow-up.' }] }),
      makeMessage({ id: 3, role: 'assistant', blocks: [{ type: 'text', id: 'a1', content: 'Answer.' }] }),
    ];

    expect(isUserTurnBoundary(messages, 0, false)).toBe(false);
    expect(isUserTurnBoundary(messages, 1, false)).toBe(false);
    expect(isUserTurnBoundary(messages, 2, false)).toBe(false);
  });

  test('returns false when a date separator already marks the boundary', () => {
    const messages = [
      makeMessage({ id: 1, role: 'assistant', blocks: [{ type: 'text', id: 'a1', content: 'Yesterday.' }] }),
      makeMessage({ id: 2, role: 'user', blocks: [{ type: 'text', id: 'u1', content: 'Today.' }] }),
    ];

    expect(isUserTurnBoundary(messages, 1, true)).toBe(false);
  });
});
