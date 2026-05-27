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

  it('forwards resultSummary into ToolCallBlock.outputSummary', () => {
    chatStore.handleToolStart(SESSION_MSG_COMPLETE, { tool_id: 'tool_3', name: 'web_search' });
    chatStore.handleToolComplete(SESSION_MSG_COMPLETE, {
      tool_id: 'tool_3',
      name: 'web_search',
      summary: 'Done',
      duration_s: 0.8,
    });
    chatStore.handleMessageComplete(SESSION_MSG_COMPLETE, { text: 'Result text', usage: null });

    const messages = chatStore.getMessages(SESSION_MSG_COMPLETE);
    const lastMsg = messages[messages.length - 1];
    const toolBlock = lastMsg.blocks.find((b) => b.type === 'tool_call');

    expect(toolBlock).toBeDefined();
    expect((toolBlock as { outputSummary: string | null }).outputSummary).toBe('Done');
    expect((toolBlock as { durationMs: number | null }).durationMs).toBe(800);
  });
});
