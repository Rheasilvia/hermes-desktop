import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { chatStore } from '../chat';
import { initializeStores } from '../context';

// Use unique session IDs per test suite to avoid cross-test signal bleed.
const SESSION_TOOL_COMPLETE = 'test-session-tool-complete';
const SESSION_NULL_SUMMARY = 'test-session-null-summary';
const SESSION_MSG_COMPLETE = 'test-session-msg-complete';
const SESSION_TOOL_IDENTITY = 'test-session-tool-identity';
const SESSION_USER_INPUT = 'test-session-user-input';

describe('request_user_input live state', () => {
  beforeEach(() => {
    chatStore.clearMessages(SESSION_USER_INPUT);
  });

  it('stores pending user input and marks the turn awaiting_user', () => {
    chatStore.handleUserInputRequest(SESSION_USER_INPUT, {
      session_id: SESSION_USER_INPUT,
      request_id: 'req-1',
      turn_id: 'turn-1',
      event_seq: 7,
      questions: [
        {
          id: 'scope',
          header: 'Scope',
          question: 'Which scope?',
          options: [{ label: 'Broad', description: 'Include recovery.' }],
        },
      ],
      status: 'pending',
    });

    const live = chatStore.getLiveState(SESSION_USER_INPUT);
    expect(live.status).toBe('awaiting_user');
    expect(live.turnId).toBe('turn-1');
    expect(live.pendingUserInput?.requestId).toBe('req-1');
    expect(chatStore.isStreaming(SESSION_USER_INPUT)).toBe(true);
  });

  it('clears pending user input when a response arrives', () => {
    chatStore.handleUserInputRequest(SESSION_USER_INPUT, {
      session_id: SESSION_USER_INPUT,
      request_id: 'req-1',
      turn_id: 'turn-1',
      questions: [
        { id: 'scope', header: 'Scope', question: 'Which scope?', options: [] },
      ],
    });
    chatStore.handleUserInputResponse(SESSION_USER_INPUT, {
      session_id: SESSION_USER_INPUT,
      request_id: 'req-1',
      turn_id: 'turn-1',
      answers: { scope: { answers: ['Broad'] } },
      status: 'answered',
    });

    const live = chatStore.getLiveState(SESSION_USER_INPUT);
    expect(live.status).toBe('accepted');
    expect(live.pendingUserInput).toBeNull();
  });
});

describe('handleToolComplete', () => {
  beforeEach(() => {
    chatStore.clearMessages(SESSION_TOOL_COMPLETE);
    chatStore.clearMessages(SESSION_NULL_SUMMARY);
  });

  it('stores summary from tool.complete payload', () => {
    chatStore.handleToolStart(SESSION_TOOL_COMPLETE, { session_id: SESSION_TOOL_COMPLETE, tool_id: 'tool_1', name: 'web_search' });
    chatStore.handleToolComplete(SESSION_TOOL_COMPLETE, { session_id: SESSION_TOOL_COMPLETE,
      tool_id: 'tool_1',
      name: 'web_search',
      summary: 'Found 5 results',
      duration_s: 1.2,
    });

    const tools = chatStore.getLiveState(SESSION_TOOL_COMPLETE).activeTools;
    expect(tools[0].resultSummary).toBe('Found 5 results');
    expect(tools[0].durationMs).toBe(1200);
    expect(tools[0].status).toBe('complete');
  });

  it('sets resultSummary to null when summary absent', () => {
    chatStore.handleToolStart(SESSION_NULL_SUMMARY, { session_id: SESSION_NULL_SUMMARY, tool_id: 'tool_2', name: 'bash' });
    chatStore.handleToolComplete(SESSION_NULL_SUMMARY, { session_id: SESSION_NULL_SUMMARY,
      tool_id: 'tool_2',
      name: 'bash',
      duration_s: 0.5,
    });

    const tools = chatStore.getLiveState(SESSION_NULL_SUMMARY).activeTools;
    expect(tools[0].resultSummary).toBeNull();
  });
});

describe('handleMessageComplete — tool blocks', () => {
  beforeEach(() => {
    chatStore.clearMessages(SESSION_MSG_COMPLETE);
  });

  it('places tool_call blocks before text blocks (reasoning → tools → text)', () => {
    // Regression: tool cards jumped to message bottom after turn completed.
    // handleMessageComplete was building [reasoning, text, tools] but
    // parseMessage (DB path) builds [reasoning, tools, text].
    chatStore.handleToolStart(SESSION_MSG_COMPLETE, { session_id: SESSION_MSG_COMPLETE, tool_id: 'order_tool', name: 'terminal' });
    chatStore.handleToolComplete(SESSION_MSG_COMPLETE, { session_id: SESSION_MSG_COMPLETE,
      tool_id: 'order_tool',
      name: 'terminal',
      duration_s: 0.1,
    });
    chatStore.handleMessageComplete(SESSION_MSG_COMPLETE, { session_id: SESSION_MSG_COMPLETE, text: 'Here is the result', usage: undefined });

    const messages = chatStore.getMessages(SESSION_MSG_COMPLETE);
    const lastMsg = messages[messages.length - 1];
    const types = lastMsg.blocks.map((b) => b.type);

    const toolIdx = types.indexOf('tool_call');
    const textIdx = types.findIndex((t) => t === 'text' || t === 'code');

    expect(toolIdx).toBeGreaterThanOrEqual(0);
    expect(textIdx).toBeGreaterThanOrEqual(0);
    expect(toolIdx).toBeLessThan(textIdx);       // tool must come BEFORE text
  });

  it('forwards resultSummary into ToolCallBlock.outputSummary', () => {
    chatStore.handleToolStart(SESSION_MSG_COMPLETE, { session_id: SESSION_MSG_COMPLETE, tool_id: 'tool_3', name: 'web_search' });
    chatStore.handleToolComplete(SESSION_MSG_COMPLETE, { session_id: SESSION_MSG_COMPLETE,
      tool_id: 'tool_3',
      name: 'web_search',
      summary: 'Done',
      duration_s: 0.8,
    });
    chatStore.handleMessageComplete(SESSION_MSG_COMPLETE, { session_id: SESSION_MSG_COMPLETE, text: 'Result text', usage: undefined });

    const messages = chatStore.getMessages(SESSION_MSG_COMPLETE);
    const lastMsg = messages[messages.length - 1];
    const toolBlock = lastMsg.blocks.find((b) => b.type === 'tool_call');

    expect(toolBlock).toBeDefined();
    expect((toolBlock as { outputSummary: string | null }).outputSummary).toBe('Done');
    expect((toolBlock as { durationMs: number | null }).durationMs).toBe(800);
  });

  it('preserves live event order when tools and text alternate', () => {
    chatStore.handleToolStart(SESSION_MSG_COMPLETE, { session_id: SESSION_MSG_COMPLETE, tool_id: 'tool_first', name: 'terminal' });
    chatStore.handleToolComplete(SESSION_MSG_COMPLETE, { session_id: SESSION_MSG_COMPLETE,
      tool_id: 'tool_first',
      name: 'terminal',
      duration_s: 0.1,
    });
    chatStore.handleDelta(SESSION_MSG_COMPLETE, { session_id: SESSION_MSG_COMPLETE, text: 'Text between tools.' });
    chatStore.handleToolStart(SESSION_MSG_COMPLETE, { session_id: SESSION_MSG_COMPLETE, tool_id: 'tool_second', name: 'read_file' });
    chatStore.handleToolComplete(SESSION_MSG_COMPLETE, { session_id: SESSION_MSG_COMPLETE,
      tool_id: 'tool_second',
      name: 'read_file',
      duration_s: 0.2,
    });
    chatStore.handleMessageComplete(SESSION_MSG_COMPLETE, { session_id: SESSION_MSG_COMPLETE, text: 'Text between tools.', usage: undefined });

    const messages = chatStore.getMessages(SESSION_MSG_COMPLETE);
    const lastMsg = messages[messages.length - 1];
    const blockOrder = lastMsg.blocks.map((block) =>
      block.type === 'tool_call' ? (block as { name: string }).name : block.type
    );

    expect(blockOrder).toEqual(['terminal', 'text', 'read_file']);
  });

  it('keeps consecutive tools together between text deltas', () => {
    chatStore.handleDelta(SESSION_MSG_COMPLETE, { session_id: SESSION_MSG_COMPLETE, text: 'Before tools.' });
    for (const [id, name] of [
      ['tool_one', 'terminal'],
      ['tool_two', 'read_file'],
      ['tool_three', 'read_file'],
    ] as const) {
      chatStore.handleToolStart(SESSION_MSG_COMPLETE, { session_id: SESSION_MSG_COMPLETE, tool_id: id, name });
      chatStore.handleToolComplete(SESSION_MSG_COMPLETE, { session_id: SESSION_MSG_COMPLETE,
        tool_id: id,
        name,
        duration_s: 0.1,
      });
    }
    chatStore.handleDelta(SESSION_MSG_COMPLETE, { session_id: SESSION_MSG_COMPLETE, text: 'After tools.' });
    chatStore.handleMessageComplete(SESSION_MSG_COMPLETE, { session_id: SESSION_MSG_COMPLETE, text: 'Before tools.After tools.', usage: undefined });

    const messages = chatStore.getMessages(SESSION_MSG_COMPLETE);
    const lastMsg = messages[messages.length - 1];
    const blockOrder = lastMsg.blocks.map((block) =>
      block.type === 'tool_call' ? (block as { name: string }).name : block.type
    );

    expect(blockOrder).toEqual(['text', 'terminal', 'read_file', 'read_file', 'text']);
  });

  it('treats complete text as a snapshot after streamed text', () => {
    chatStore.handleDelta(SESSION_MSG_COMPLETE, { session_id: SESSION_MSG_COMPLETE, text: 'I will inspect first.' });
    chatStore.handleToolStart(SESSION_MSG_COMPLETE, { session_id: SESSION_MSG_COMPLETE, tool_id: 'tool_final', name: 'terminal' });
    chatStore.handleToolComplete(SESSION_MSG_COMPLETE, { session_id: SESSION_MSG_COMPLETE,
      tool_id: 'tool_final',
      name: 'terminal',
      duration_s: 0.1,
    });
    chatStore.handleMessageComplete(SESSION_MSG_COMPLETE, { session_id: SESSION_MSG_COMPLETE, text: 'Final answer.', usage: undefined });

    const messages = chatStore.getMessages(SESSION_MSG_COMPLETE);
    const lastMsg = messages[messages.length - 1];
    const blockOrder = lastMsg.blocks.map((block) =>
      block.type === 'tool_call' ? (block as { name: string }).name : block.type
    );
    const textBlocks = lastMsg.blocks
      .filter((block) => block.type === 'text')
      .map((block) => (block as { content: string }).content);

    expect(blockOrder).toEqual(['text', 'terminal']);
    expect(textBlocks).toEqual(['I will inspect first.']);
  });

  it('deduplicates complete text when streamed text only differs by leading whitespace', () => {
    const finalText = '当前目录是：\n\n```\n/Users/chenmengjie/Documents/Repos/claude-code-source-code\n```';
    chatStore.handleToolStart(SESSION_MSG_COMPLETE, { session_id: SESSION_MSG_COMPLETE, tool_id: 'tool_pwd', name: 'terminal' });
    chatStore.handleToolComplete(SESSION_MSG_COMPLETE, { session_id: SESSION_MSG_COMPLETE,
      tool_id: 'tool_pwd',
      name: 'terminal',
      duration_s: 0.1,
    });
    chatStore.handleDelta(SESSION_MSG_COMPLETE, { session_id: SESSION_MSG_COMPLETE, text: `\n\n${finalText}` });
    chatStore.handleMessageComplete(SESSION_MSG_COMPLETE, { session_id: SESSION_MSG_COMPLETE, text: finalText, usage: undefined });

    const messages = chatStore.getMessages(SESSION_MSG_COMPLETE);
    const lastMsg = messages[messages.length - 1];
    const textBlocks = lastMsg.blocks
      .filter((block) => block.type === 'text')
      .map((block) => (block as { content: string }).content);
    const codeBlocks = lastMsg.blocks
      .filter((block) => block.type === 'code')
      .map((block) => (block as { content: string }).content);

    expect(textBlocks).toEqual(['\n\n当前目录是：\n\n']);
    expect(codeBlocks).toEqual(['/Users/chenmengjie/Documents/Repos/claude-code-source-code\n']);
  });
});

describe('live tool identity', () => {
  beforeEach(() => {
    chatStore.clearMessages(SESSION_TOOL_IDENTITY);
  });

  it('deduplicates repeated tool.start events by tool_id', () => {
    chatStore.handleToolStart(SESSION_TOOL_IDENTITY, { session_id: SESSION_TOOL_IDENTITY, tool_id: 'tool_1', name: 'web_search' });
    chatStore.handleToolStart(SESSION_TOOL_IDENTITY, { session_id: SESSION_TOOL_IDENTITY, tool_id: 'tool_1', name: 'web_search' });

    const tools = chatStore.getLiveState(SESSION_TOOL_IDENTITY).activeTools;
    expect(tools).toHaveLength(1);
    expect(tools[0]).toMatchObject({ id: 'tool_1', name: 'web_search', status: 'running' });
  });

  it('merges tool.generating into tool.start with the same id', () => {
    chatStore.handleToolGenerating(SESSION_TOOL_IDENTITY, { session_id: SESSION_TOOL_IDENTITY,
      tool_id: 'tool_1',
      name: 'web_search',
      text: '{"query"',
    });
    chatStore.handleToolStart(SESSION_TOOL_IDENTITY, { session_id: SESSION_TOOL_IDENTITY, tool_id: 'tool_1', name: 'web_search' });

    const tools = chatStore.getLiveState(SESSION_TOOL_IDENTITY).activeTools;
    expect(tools).toHaveLength(1);
    expect(tools[0].status).toBe('running');
    expect(tools[0].inputPreview).toBe('{"query"');
  });

  it('updates only the tool row that matches tool.progress tool_id', () => {
    chatStore.handleToolStart(SESSION_TOOL_IDENTITY, { session_id: SESSION_TOOL_IDENTITY, tool_id: 'tool_a', name: 'bash' });
    chatStore.handleToolStart(SESSION_TOOL_IDENTITY, { session_id: SESSION_TOOL_IDENTITY, tool_id: 'tool_b', name: 'bash' });
    chatStore.handleToolProgress(SESSION_TOOL_IDENTITY, { session_id: SESSION_TOOL_IDENTITY,
      tool_id: 'tool_b',
      name: 'bash',
      preview: 'running second command',
    });

    const tools = chatStore.getLiveState(SESSION_TOOL_IDENTITY).activeTools;
    expect(tools.find((t) => t.id === 'tool_a')?.progressPreview).toBeNull();
    expect(tools.find((t) => t.id === 'tool_b')?.progressPreview).toBe('running second command');
  });

  it('updates only the latest matching running tool for legacy progress events without id', () => {
    chatStore.handleToolStart(SESSION_TOOL_IDENTITY, { session_id: SESSION_TOOL_IDENTITY, tool_id: 'tool_a', name: 'bash' });
    chatStore.handleToolStart(SESSION_TOOL_IDENTITY, { session_id: SESSION_TOOL_IDENTITY, tool_id: 'tool_b', name: 'bash' });
    chatStore.handleToolProgress(SESSION_TOOL_IDENTITY, { session_id: SESSION_TOOL_IDENTITY,
      name: 'bash',
      preview: 'legacy progress',
    });

    const tools = chatStore.getLiveState(SESSION_TOOL_IDENTITY).activeTools;
    expect(tools.find((t) => t.id === 'tool_a')?.progressPreview).toBeNull();
    expect(tools.find((t) => t.id === 'tool_b')?.progressPreview).toBe('legacy progress');
  });
});

describe('handleMessageComplete — empty assistant turns', () => {
  const SESSION_EMPTY_COMPLETE = 'test-session-empty-complete';

  beforeEach(() => {
    chatStore.clearMessages(SESSION_EMPTY_COMPLETE);
  });

  it('does not append an assistant message when complete text and live blocks are empty', () => {
    chatStore.handleMessageComplete(SESSION_EMPTY_COMPLETE, { session_id: SESSION_EMPTY_COMPLETE, text: '', usage: undefined });

    expect(chatStore.getMessages(SESSION_EMPTY_COMPLETE)).toHaveLength(0);
  });
});

describe('appendUserMessage — slash command metadata', () => {
  const SESSION_SLASH = 'test-session-slash';
  beforeEach(() => {
    chatStore.clearMessages(SESSION_SLASH);
  });

  it('attaches slashCommand and keeps the compact text in blocks', () => {
    const id = chatStore.appendUserMessage(SESSION_SLASH, '/arxiv 这是什么命令？', { command: 'arxiv', args: '这是什么命令？' }, 'expanded arxiv prompt');
    const messages = chatStore.getMessages(SESSION_SLASH);
    const msg = messages[messages.length - 1];
    expect(msg.id).toBe(id);
    expect(msg.slashCommand).toEqual({ command: 'arxiv', args: '这是什么命令？' });
    expect(msg.submitText).toBe('expanded arxiv prompt');
    const text = msg.blocks.filter((b) => b.type === 'text').map((b) => (b as { content: string }).content).join('');
    expect(text).toBe('/arxiv 这是什么命令？');
  });

  it('leaves slashCommand undefined for a normal message', () => {
    chatStore.appendUserMessage(SESSION_SLASH, 'just a message');
    const messages = chatStore.getMessages(SESSION_SLASH);
    expect(messages[messages.length - 1].slashCommand).toBeUndefined();
  });

  it('marks an optimistic user message as failed and can remove it for retry', () => {
    const id = chatStore.appendUserMessage(SESSION_SLASH, 'please send');

    expect(chatStore.markUserMessageFailed(SESSION_SLASH, id, 'Failed to send message')).toBe(true);
    let messages = chatStore.getMessages(SESSION_SLASH);
    expect(messages[messages.length - 1]).toMatchObject({
      id,
      deliveryStatus: 'failed',
      failedReason: 'Failed to send message',
    });

    const removed = chatStore.removeMessage(SESSION_SLASH, id);
    messages = chatStore.getMessages(SESSION_SLASH);
    expect(removed?.id).toBe(id);
    expect(messages.find((message) => message.id === id)).toBeUndefined();
  });
});

describe('conversation turn stability', () => {
  const SESSION_TURN = 'test-session-turn-stability';

  beforeEach(() => {
    vi.useFakeTimers();
    chatStore.clearMessages(SESSION_TURN);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('ignores late stream events after an interrupt barrier', async () => {
    chatStore.handleMessageStart(SESSION_TURN);
    chatStore.handleDelta(SESSION_TURN, { session_id: SESSION_TURN, text: 'partial' });

    await chatStore.cancelMessage(SESSION_TURN);
    chatStore.handleDelta(SESSION_TURN, { session_id: SESSION_TURN, text: ' late' });
    chatStore.handleMessageComplete(SESSION_TURN, { session_id: SESSION_TURN, text: 'partial late', usage: undefined });

    const messages = chatStore.getMessages(SESSION_TURN);
    expect(messages).toHaveLength(1);
    expect(chatStore.getLiveState(SESSION_TURN).streamingText).toBe('');
    expect(chatStore.getDiagnostics(SESSION_TURN).droppedLateEvents).toBe(2);
  });

  it('moves an accepted turn to stalled when no stream events arrive before the watchdog timeout', () => {
    chatStore.markPromptAccepted(SESSION_TURN);

    vi.advanceTimersByTime(90_000);

    expect(chatStore.getLiveState(SESSION_TURN).status).toBe('stalled');
    expect(chatStore.getDiagnostics(SESSION_TURN).turnState).toBe('stalled');
  });

  it('keeps the accepted turn active when a stream event arrives before the watchdog timeout', () => {
    chatStore.markPromptAccepted(SESSION_TURN);
    vi.advanceTimersByTime(30_000);
    chatStore.handleDelta(SESSION_TURN, { session_id: SESSION_TURN, text: 'hello' });
    vi.advanceTimersByTime(70_000);

    expect(chatStore.getLiveState(SESSION_TURN).status).toBe('streaming');
    expect(chatStore.getLiveState(SESSION_TURN).streamingText).toBe('hello');
  });

  it('binds the accepted live turn to the turn_id returned by prompt.execute', async () => {
    initializeStores({
      prompt: {
        execute: vi.fn().mockResolvedValue({ turn_id: 'turn_accept', user_seq: 1 }),
      },
    } as any);

    await chatStore.sendMessage(SESSION_TURN, 'hello');

    expect(chatStore.getLiveState(SESSION_TURN)).toMatchObject({
      status: 'accepted',
      turnId: 'turn_accept',
    });
  });

  it('ignores stale events from a different turn while a live turn is active', () => {
    chatStore.markPromptAccepted(SESSION_TURN, 'turn_current');

    chatStore.handleDelta(SESSION_TURN, {
      session_id: SESSION_TURN,
      text: 'old text',
      turn_id: 'turn_old',
      event_seq: 2,
    } as any);

    expect(chatStore.getLiveState(SESSION_TURN)).toMatchObject({
      status: 'accepted',
      turnId: 'turn_current',
      streamingText: '',
    });
  });

  it('ignores stale errors from a different turn while a live turn is active', () => {
    chatStore.handleDelta(SESSION_TURN, {
      session_id: SESSION_TURN,
      text: 'new text',
      turn_id: 'turn_current',
      event_seq: 4,
    } as any);

    chatStore.handleError(SESSION_TURN, {
      session_id: SESSION_TURN,
      message: 'old failure',
      turn_id: 'turn_old',
      event_seq: 5,
    } as any);

    expect(chatStore.getLiveState(SESSION_TURN)).toMatchObject({
      status: 'streaming',
      turnId: 'turn_current',
      streamingText: 'new text',
      errorMessage: null,
    });
  });

  it('finalizes a matching turn.interrupted event from another client', () => {
    chatStore.handleDelta(SESSION_TURN, {
      session_id: SESSION_TURN,
      text: 'partial',
      turn_id: 'turn_interrupt',
      event_seq: 2,
    } as any);

    chatStore.handleTurnInterrupted(SESSION_TURN, {
      session_id: SESSION_TURN,
      reason: 'user_interrupt',
      turn_id: 'turn_interrupt',
      event_seq: 3,
    } as any);

    const messages = chatStore.getMessages(SESSION_TURN);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ role: 'assistant', turnId: 'turn_interrupt' });
    expect(chatStore.getLiveState(SESSION_TURN).status).toBe('idle');
  });
});

describe('loadMessages — transcript hydrate', () => {
  const SESSION_TRANSCRIPT = 'test-session-transcript-hydrate';

  beforeEach(() => {
    chatStore.clearMessages(SESSION_TRANSCRIPT);
  });

  it('hydrates completed transcript messages without creating a live assistant', async () => {
    initializeStores({
      session: {
        transcript: vi.fn().mockResolvedValue({
          session_id: SESSION_TRANSCRIPT,
          max_seq: 2,
          messages: [
            { id: 1, turn_id: 'turn_hydrate', role: 'user', content: 'hi', timestamp: 1, status: 'completed' },
            { id: 2, turn_id: 'turn_hydrate', role: 'assistant', content: 'hello', timestamp: 2, status: 'completed' },
          ],
          live_turn: null,
        }),
      },
    } as any);

    await chatStore.loadMessages(SESSION_TRANSCRIPT);

    const messages = chatStore.getMessages(SESSION_TRANSCRIPT);
    expect(messages.map((message) => message.role)).toEqual(['user', 'assistant']);
    expect(chatStore.getLiveState(SESSION_TRANSCRIPT).status).toBe('idle');
    expect(chatStore.getLiveState(SESSION_TRANSCRIPT).streamingText).toBe('');
  });

  it('hydrates completed transcript messages from ordered assistant blocks', async () => {
    initializeStores({
      session: {
        transcript: vi.fn().mockResolvedValue({
          session_id: SESSION_TRANSCRIPT,
          max_seq: 2,
          messages: [
            { id: 1, turn_id: 'turn_blocks', role: 'user', content: 'hi', timestamp: 1, status: 'completed' },
            {
              id: 2,
              turn_id: 'turn_blocks',
              role: 'assistant',
              content: 'Legacy fallback',
              reasoning: 'Legacy reasoning',
              tool_calls: [
                { id: 'legacy_tool', name: 'legacy', arguments: {}, status: 'complete' },
              ],
              blocks: [
                { type: 'text', id: 'text_before', content: 'Before tool.' },
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
                { type: 'text', id: 'text_after', content: 'Final answer.' },
              ],
              timestamp: 2,
              status: 'completed',
            },
          ],
          live_turn: null,
        }),
      },
    } as any);

    await chatStore.loadMessages(SESSION_TRANSCRIPT);

    const assistant = chatStore.getMessages(SESSION_TRANSCRIPT).find((message) => message.role === 'assistant');
    const order = assistant?.blocks.map((block) =>
      block.type === 'tool_call' ? block.name : block.type
    );
    expect(order).toEqual(['text', 'terminal', 'text']);
  });

  it('hydrates a running transcript turn into liveState instead of messages', async () => {
    initializeStores({
      session: {
        transcript: vi.fn().mockResolvedValue({
          session_id: SESSION_TRANSCRIPT,
          max_seq: 3,
          messages: [
            { id: 1, turn_id: 'turn_live', role: 'user', content: 'hi', timestamp: 1, status: 'completed' },
          ],
          live_turn: {
            turn_id: 'turn_live',
            status: 'running',
            content: 'partial',
            reasoning: 'thinking',
            tools: [],
            todos: [],
            last_event_seq: 3,
            started_at: 1,
            updated_at: 3,
          },
        }),
      },
    } as any);

    await chatStore.loadMessages(SESSION_TRANSCRIPT);

    expect(chatStore.getMessages(SESSION_TRANSCRIPT).map((message) => message.role)).toEqual(['user']);
    expect(chatStore.getLiveState(SESSION_TRANSCRIPT)).toMatchObject({
      turnId: 'turn_live',
      status: 'streaming',
      streamingText: 'partial',
      reasoningText: 'thinking',
      lastEventSeq: 3,
    });
  });

  it('keeps newer live SSE state when transcript hydrate returns an older live turn', async () => {
    initializeStores({
      session: {
        transcript: vi.fn().mockResolvedValue({
          session_id: SESSION_TRANSCRIPT,
          max_seq: 3,
          messages: [
            { id: 1, turn_id: 'turn_live', role: 'user', content: 'hi', timestamp: 1, status: 'completed' },
          ],
          live_turn: {
            turn_id: 'turn_live',
            status: 'running',
            content: 'partial',
            reasoning: '',
            tools: [],
            todos: [],
            last_event_seq: 3,
            started_at: 1,
            updated_at: 3,
          },
        }),
      },
    } as any);

    chatStore.handleDelta(SESSION_TRANSCRIPT, {
      session_id: SESSION_TRANSCRIPT,
      text: 'partial newer',
      turn_id: 'turn_live',
      event_seq: 4,
    } as any);

    await chatStore.loadMessages(SESSION_TRANSCRIPT);

    expect(chatStore.getLiveState(SESSION_TRANSCRIPT)).toMatchObject({
      turnId: 'turn_live',
      streamingText: 'partial newer',
      lastEventSeq: 4,
    });
  });

  it('keeps newer live SSE state when transcript hydrate has no live turn yet', async () => {
    initializeStores({
      session: {
        transcript: vi.fn().mockResolvedValue({
          session_id: SESSION_TRANSCRIPT,
          max_seq: 1,
          messages: [
            { id: 1, turn_id: 'turn_prev', role: 'user', content: 'previous', timestamp: 1, status: 'completed' },
          ],
          live_turn: null,
        }),
      },
    } as any);

    chatStore.handleDelta(SESSION_TRANSCRIPT, {
      session_id: SESSION_TRANSCRIPT,
      text: 'new live',
      turn_id: 'turn_newer',
      event_seq: 4,
    } as any);

    await chatStore.loadMessages(SESSION_TRANSCRIPT);

    expect(chatStore.getLiveState(SESSION_TRANSCRIPT)).toMatchObject({
      turnId: 'turn_newer',
      streamingText: 'new live',
      lastEventSeq: 4,
    });
  });
});

describe('handleMessageComplete — turn_id dedupe', () => {
  const SESSION_DEDUPE = 'test-session-turn-dedupe';

  beforeEach(() => {
    chatStore.clearMessages(SESSION_DEDUPE);
  });

  it('does not append a second assistant for a duplicate complete with the same turn_id', () => {
    chatStore.handleDelta(SESSION_DEDUPE, {
      session_id: SESSION_DEDUPE,
      text: 'hello',
      turn_id: 'turn_duplicate',
      event_seq: 2,
    } as any);
    chatStore.handleMessageComplete(SESSION_DEDUPE, {
      session_id: SESSION_DEDUPE,
      text: 'hello',
      turn_id: 'turn_duplicate',
      event_seq: 3,
    } as any);
    chatStore.handleMessageComplete(SESSION_DEDUPE, {
      session_id: SESSION_DEDUPE,
      text: 'hello',
      turn_id: 'turn_duplicate',
      event_seq: 3,
    } as any);

    const assistants = chatStore.getMessages(SESSION_DEDUPE).filter((message) => message.role === 'assistant');
    expect(assistants).toHaveLength(1);
  });
});
