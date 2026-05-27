import { describe, it, expect } from 'vitest';
import { parseMessage } from '../messageParser';
import type { ConversationMessage } from '@/types/domain/message';

function makeMsg(overrides: Partial<ConversationMessage> = {}): ConversationMessage {
  return {
    id: 1,
    sessionId: 'sess_1',
    role: 'assistant',
    content: 'Done',
    toolCalls: null,
    toolCallId: null,
    toolName: null,
    reasoning: null,
    timestamp: 1700000000,
    tokenCount: null,
    finishReason: null,
    attachments: null,
    ...overrides,
  };
}

describe('toolCallToBlock', () => {
  it('forwards outputSummary and durationMs from ParsedToolCall', () => {
    const msg = makeMsg({
      toolCalls: [
        {
          id: 'tool_abc',
          name: 'web_search',
          arguments: { query: 'test' },
          status: 'complete',
          outputSummary: 'Found 3 results',
          durationMs: 950,
        },
      ],
    });

    const rendered = parseMessage(msg);
    const toolBlock = rendered.blocks.find((b) => b.type === 'tool_call');

    expect(toolBlock).toBeDefined();
    expect(toolBlock!.outputSummary).toBe('Found 3 results');
    expect(toolBlock!.durationMs).toBe(950);
  });

  it('uses null when outputSummary and durationMs are absent', () => {
    const msg = makeMsg({
      toolCalls: [
        { id: 'tool_xyz', name: 'bash', arguments: { cmd: 'ls' }, status: 'complete' },
      ],
    });

    const rendered = parseMessage(msg);
    const toolBlock = rendered.blocks.find((b) => b.type === 'tool_call');

    expect(toolBlock!.outputSummary).toBeNull();
    expect(toolBlock!.durationMs).toBeNull();
  });
});
