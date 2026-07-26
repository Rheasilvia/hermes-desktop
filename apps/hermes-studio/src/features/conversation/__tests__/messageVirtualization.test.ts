import { describe, expect, it } from 'vitest';
import type { RenderedMessage } from '@/types/index.js';
import { virtualizeMessages } from '../messageVirtualization.js';

function message(index: number): RenderedMessage {
  return {
    id: `msg-${index}`,
    sessionId: 'session-1',
    role: index % 2 === 0 ? 'user' : 'assistant',
    blocks: [{ type: 'text', id: `block-${index}`, content: `message ${index}` }],
    timestamp: index,
    tokenCount: null,
    finishReason: null,
    isStreaming: false,
    actions: [],
    toolName: null,
  };
}

describe('virtualizeMessages', () => {
  it('keeps small transcripts unvirtualized', () => {
    const messages = Array.from({ length: 10 }, (_, index) => message(index));

    const range = virtualizeMessages(messages, 0, 300, { threshold: 20, rowHeight: 100, overscanRows: 1 });

    expect(range.virtualized).toBe(false);
    expect(range.messages).toEqual(messages);
    expect(range.beforeHeight).toBe(0);
    expect(range.afterHeight).toBe(0);
  });

  it('renders a bounded window with spacers for long transcripts', () => {
    const messages = Array.from({ length: 100 }, (_, index) => message(index));

    const range = virtualizeMessages(messages, 5_000, 500, { threshold: 20, rowHeight: 100, overscanRows: 2 });

    expect(range.virtualized).toBe(true);
    expect(range.startIndex).toBe(48);
    expect(range.messages[0]?.id).toBe('msg-48');
    expect(range.endIndex).toBe(57);
    expect(range.beforeHeight).toBe(4_800);
    expect(range.afterHeight).toBe(4_300);
  });

  it('can default the initial long transcript window to the tail', () => {
    const messages = Array.from({ length: 100 }, (_, index) => message(index));

    const range = virtualizeMessages(messages, 0, 500, {
      threshold: 20,
      rowHeight: 100,
      overscanRows: 2,
      defaultToBottom: true,
    });

    expect(range.messages[range.messages.length - 1]?.id).toBe('msg-99');
    expect(range.afterHeight).toBe(0);
    expect(range.beforeHeight).toBeGreaterThan(0);
  });
});
