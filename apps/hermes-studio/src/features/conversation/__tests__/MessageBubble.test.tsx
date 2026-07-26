import { render } from '@solidjs/testing-library';
import { describe, expect, it } from 'vitest';
import { MessageBubble } from '../MessageBubble.js';
import type { RenderedMessage } from '@/types/index.js';

function userMessage(): RenderedMessage {
  return {
    id: 1,
    sessionId: 'sess',
    role: 'user',
    blocks: [{ type: 'text', id: 't1', content: 'Continue here.' }],
    timestamp: 0,
    tokenCount: null,
    finishReason: null,
    isStreaming: false,
    actions: [],
    toolName: null,
  };
}

describe('MessageBubble turn boundaries', () => {
  it('applies a turn-boundary class when requested', () => {
    const { container } = render(() => (
      <MessageBubble message={userMessage()} turnBoundary />
    ));

    expect(container.firstElementChild?.className).toContain('wrapperTurnBoundary');
  });
});
