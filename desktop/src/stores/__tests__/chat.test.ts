import { describe, it, expect, beforeEach } from 'vitest';
import { chatStore } from '../chat';

// Use unique session IDs per test suite to avoid cross-test signal bleed.
const SESSION_TOOL_COMPLETE = 'test-session-tool-complete';
const SESSION_NULL_SUMMARY = 'test-session-null-summary';
const SESSION_MSG_COMPLETE = 'test-session-msg-complete';

describe('handleToolComplete', () => {
  beforeEach(() => {
    chatStore.clearMessages(SESSION_TOOL_COMPLETE);
    chatStore.clearMessages(SESSION_NULL_SUMMARY);
  });

  it('stores summary from tool.complete payload', () => {
    chatStore.handleToolStart(SESSION_TOOL_COMPLETE, { tool_id: 'tool_1', name: 'web_search' });
    chatStore.handleToolComplete(SESSION_TOOL_COMPLETE, {
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
    chatStore.handleToolStart(SESSION_NULL_SUMMARY, { tool_id: 'tool_2', name: 'bash' });
    chatStore.handleToolComplete(SESSION_NULL_SUMMARY, {
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
    chatStore.handleToolStart(SESSION_MSG_COMPLETE, { tool_id: 'order_tool', name: 'terminal' });
    chatStore.handleToolComplete(SESSION_MSG_COMPLETE, {
      tool_id: 'order_tool',
      name: 'terminal',
      duration_s: 0.1,
    });
    chatStore.handleMessageComplete(SESSION_MSG_COMPLETE, { text: 'Here is the result', usage: undefined });

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
    chatStore.handleToolStart(SESSION_MSG_COMPLETE, { tool_id: 'tool_3', name: 'web_search' });
    chatStore.handleToolComplete(SESSION_MSG_COMPLETE, {
      tool_id: 'tool_3',
      name: 'web_search',
      summary: 'Done',
      duration_s: 0.8,
    });
    chatStore.handleMessageComplete(SESSION_MSG_COMPLETE, { text: 'Result text', usage: undefined });

    const messages = chatStore.getMessages(SESSION_MSG_COMPLETE);
    const lastMsg = messages[messages.length - 1];
    const toolBlock = lastMsg.blocks.find((b) => b.type === 'tool_call');

    expect(toolBlock).toBeDefined();
    expect((toolBlock as { outputSummary: string | null }).outputSummary).toBe('Done');
    expect((toolBlock as { durationMs: number | null }).durationMs).toBe(800);
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
