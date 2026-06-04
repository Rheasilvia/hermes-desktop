import { describe, it, expect, vi } from 'vitest';
import { HttpGatewayAdapter } from '../http-adapter';

/**
 * The HttpGatewayAdapter constructor takes an optional HttpClient.
 * We pass no argument to get the default (which tries to use httpClient,
 * but we never trigger real HTTP calls in these unit tests).
 * dispatchSseEvent is private, so we access it via (adapter as any).
 */
function makeAdapter() {
  // Provide a minimal mock http client so the constructor doesn't try to
  // import env vars or do anything side-effectful.
  const mockHttp = {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  };
  return new HttpGatewayAdapter(mockHttp as any);
}

describe('dispatchSseEvent — tool.generating', () => {
  it('emits name field alongside tool_id and text', () => {
    const adapter = makeAdapter();
    const received: unknown[] = [];
    adapter.on('tool.generating', (payload) => received.push(payload));

    (adapter as any).dispatchSseEvent({
      session_id: 'sess_1',
      seq: 1,
      type: 'tool.generating',
      payload: { tool_id: 'tool_1', name: 'web_search', text: 'arg chunk' },
    });

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ tool_id: 'tool_1', name: 'web_search', text: 'arg chunk' });
  });
});

describe('dispatchSseEvent — tool.progress', () => {
  it('emits tool.progress event with tool_id when present', () => {
    const adapter = makeAdapter();
    const received: unknown[] = [];
    adapter.on('tool.progress', (payload) => received.push(payload));

    (adapter as any).dispatchSseEvent({
      session_id: 'sess_1',
      seq: 2,
      type: 'tool.progress',
      payload: { tool_id: 'tool_1', name: 'web_search', preview: '3/10 results fetched' },
    });

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({
      tool_id: 'tool_1',
      name: 'web_search',
      preview: '3/10 results fetched',
    });
  });
});

describe('commands HTTP methods', () => {
  it('maps complete.slash to the desktop commands endpoint', async () => {
    const mockHttp = {
      get: vi.fn(),
      post: vi.fn().mockResolvedValue({
        items: [{ command: 'model', description: 'Switch model', category: 'Configuration' }],
      }),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    };
    const adapter = new HttpGatewayAdapter(mockHttp as any);

    const result = await adapter.complete.slash({ partial: '/mo' });

    expect(mockHttp.post).toHaveBeenCalledWith('/desktop/api/commands/complete/slash', { partial: '/mo' });
    expect(result).toEqual([{ command: 'model', description: 'Switch model', category: 'Configuration' }]);
  });

  it('posts slash.exec and returns the structured command result', async () => {
    const mockHttp = {
      get: vi.fn(),
      post: vi.fn().mockResolvedValue({ kind: 'output', message: 'Available slash commands' }),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    };
    const adapter = new HttpGatewayAdapter(mockHttp as any);

    const result = await adapter.slash.exec({ session_id: 'sess_1', command: 'help', raw: '/help' });

    expect(mockHttp.post).toHaveBeenCalledWith('/desktop/api/commands/slash/exec', {
      session_id: 'sess_1',
      command: 'help',
      raw: '/help',
    });
    expect(result).toEqual({ kind: 'output', message: 'Available slash commands' });
  });
});

describe('aggregateEventRows — tool call reconstruction', () => {
  it('includes tool calls from stored tool.start/complete rows', () => {
    const adapter = makeAdapter();

    const rows = [
      { seq: 1, type: 'tool.start',      payload: { tool_id: 'tool_1', name: 'web_search' } },
      { seq: 2, type: 'tool.generating', payload: { tool_id: 'tool_1', name: 'web_search', text: '{"query":"test"}' } },
      { seq: 3, type: 'tool.complete',   payload: { tool_id: 'tool_1', name: 'web_search', summary: 'Found 5 results', duration_s: 1.2 } },
      { seq: 4, type: 'message.delta',   payload: { text: 'Here are the results' } },
      { seq: 5, type: 'message.complete', payload: { text: 'Here are the results', usage: null } },
    ];

    const messages = (adapter as any).aggregateEventRows('sess_1', rows);
    const assistantMsg = messages.find((m: any) => m.role === 'assistant');

    expect(assistantMsg).toBeDefined();
    expect(assistantMsg.tool_calls).toHaveLength(1);
    expect(assistantMsg.tool_calls[0]).toMatchObject({
      name: 'web_search',
      status: 'complete',
      outputSummary: 'Found 5 results',
      durationMs: 1200,
    });
  });

  it('assigns seqIndex in tool.start arrival order (not completion order)', () => {
    const adapter = makeAdapter();

    const rows = [
      { seq: 1, type: 'tool.start',    payload: { tool_id: 'tool_a', name: 'read_file' } },
      { seq: 2, type: 'tool.start',    payload: { tool_id: 'tool_b', name: 'web_search' } },
      { seq: 3, type: 'tool.complete', payload: { tool_id: 'tool_b', name: 'web_search', duration_s: 0.5 } },
      { seq: 4, type: 'tool.complete', payload: { tool_id: 'tool_a', name: 'read_file',  duration_s: 0.3 } },
      { seq: 5, type: 'message.complete', payload: { text: 'Done', usage: null } },
    ];

    const messages = (adapter as any).aggregateEventRows('sess_1', rows);
    const tc = messages[0].tool_calls;
    expect(tc[0].name).toBe('read_file');    // arrived first → seq 0
    expect(tc[1].name).toBe('web_search');   // arrived second → seq 1
  });

  it('reconstructs a tool call from tool.generating before duplicate tool.start', () => {
    const adapter = makeAdapter();

    const rows = [
      { seq: 1, type: 'tool.generating', payload: { tool_id: 'tool_1', name: 'web_search', text: '{"query":"test"}' } },
      { seq: 2, type: 'tool.start', payload: { tool_id: 'tool_1', name: 'web_search' } },
      { seq: 3, type: 'tool.start', payload: { tool_id: 'tool_1', name: 'web_search' } },
      { seq: 4, type: 'tool.complete', payload: { tool_id: 'tool_1', name: 'web_search', summary: 'Found results' } },
      { seq: 5, type: 'message.complete', payload: { text: '', usage: null } },
    ];

    const messages = (adapter as any).aggregateEventRows('sess_1', rows);
    const assistantMsg = messages.find((m: any) => m.role === 'assistant');

    expect(assistantMsg).toBeDefined();
    expect(assistantMsg.content).toBe('');
    expect(assistantMsg.tool_calls).toHaveLength(1);
    expect(assistantMsg.tool_calls[0]).toMatchObject({
      id: 'tool_1',
      name: 'web_search',
      status: 'complete',
      arguments: { query: 'test' },
      outputSummary: 'Found results',
    });
  });
});
