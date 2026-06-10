import { describe, test, expect } from 'vitest';
import { resolveMessageCopyText, resolveMessageEditDraft } from '../ChatView.js';
import type { RenderedMessage } from '@/types/index.js';

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
