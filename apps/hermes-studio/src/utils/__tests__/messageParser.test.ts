import { describe, it, expect } from 'vitest';
import { parseMessage } from '../messageParser';
import type { ConversationMessage } from '@/types/domain/message';
import type { MessageBlock } from '@/types/ui/blocks';

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

  it('prefers persisted ordered blocks over legacy reconstructed fields', () => {
    const blocks: MessageBlock[] = [
      { type: 'text', id: 'text_1', content: 'Before tool.' },
      {
        type: 'tool_call',
        id: 'tc_tool_1',
        toolId: 'tool_1',
        name: 'terminal',
        status: 'complete',
        inputPreview: null,
        outputSummary: 'done',
        inlineDiff: null,
        durationMs: 100,
      },
      { type: 'text', id: 'text_2', content: 'Final answer.' },
    ];
    const msg = makeMsg({
      content: 'Legacy content should not be appended',
      reasoning: 'Legacy reasoning should not be prepended',
      blocks,
      toolCalls: [
        { id: 'legacy_tool', name: 'legacy', arguments: {}, status: 'complete' },
      ],
    });

    const rendered = parseMessage(msg);
    const order = rendered.blocks.map((block) =>
      block.type === 'tool_call' ? block.name : block.type
    );

    expect(order).toEqual(['text', 'terminal', 'text']);
    expect(rendered.blocks.some((block) =>
      block.type === 'text' && block.content.includes('Legacy content')
    )).toBe(false);
  });
});
