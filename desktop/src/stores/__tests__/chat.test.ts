import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { chatStore } from '../chat';

// Use unique session IDs per test suite to avoid cross-test signal bleed.
const SESSION_TOOL_COMPLETE = 'test-session-tool-complete';
const SESSION_NULL_SUMMARY = 'test-session-null-summary';
const SESSION_MSG_COMPLETE = 'test-session-msg-complete';
const SESSION_TOOL_IDENTITY = 'test-session-tool-identity';

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
    chatStore.appendUserMessage(SESSION_SLASH, '/arxiv 这是什么命令？', { command: 'arxiv', args: '这是什么命令？' });
    const messages = chatStore.getMessages(SESSION_SLASH);
    const msg = messages[messages.length - 1];
    expect(msg.slashCommand).toEqual({ command: 'arxiv', args: '这是什么命令？' });
    const text = msg.blocks.filter((b) => b.type === 'text').map((b) => (b as { content: string }).content).join('');
    expect(text).toBe('/arxiv 这是什么命令？');
  });

  it('leaves slashCommand undefined for a normal message', () => {
    chatStore.appendUserMessage(SESSION_SLASH, 'just a message');
    const messages = chatStore.getMessages(SESSION_SLASH);
    expect(messages[messages.length - 1].slashCommand).toBeUndefined();
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
});
