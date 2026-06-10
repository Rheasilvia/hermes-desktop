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

describe('dispatchSseEvent — envelope and idempotency', () => {
  it('drops duplicate or older seq events for the same session', () => {
    const adapter = makeAdapter();
    const received: unknown[] = [];
    adapter.on('message.delta', (payload) => received.push(payload));

    (adapter as any).dispatchSseEvent({
      session_id: 'sess_1',
      seq: 10,
      type: 'message.delta',
      payload: { text: 'first' },
    });
    (adapter as any).dispatchSseEvent({
      session_id: 'sess_1',
      seq: 10,
      type: 'message.delta',
      payload: { text: 'duplicate' },
    });
    (adapter as any).dispatchSseEvent({
      session_id: 'sess_1',
      seq: 9,
      type: 'message.delta',
      payload: { text: 'older' },
    });

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ session_id: 'sess_1', text: 'first', event_seq: 10 });
  });

  it('normalizes raw SSE rows to a GatewayEventEnvelope before dispatch', () => {
    const adapter = makeAdapter();

    const envelope = (adapter as any).normalizeSseEvent({
      session_id: 'sess_1',
      seq: 4,
      type: 'tool.progress',
      payload: { tool_id: 'tool_1', name: 'bash', preview: 'running' },
    });

    expect(envelope).toMatchObject({
      sessionId: 'sess_1',
      seq: 4,
      type: 'tool.progress',
      payload: { tool_id: 'tool_1', name: 'bash', preview: 'running' },
    });
    expect(typeof envelope.receivedAt).toBe('number');
  });
});

describe('dispatchSseEvent — turn.interrupted', () => {
  it('emits turn.interrupted with turn_id and event_seq', () => {
    const adapter = makeAdapter();
    const received: unknown[] = [];
    adapter.on('turn.interrupted' as any, (payload) => received.push(payload));

    (adapter as any).dispatchSseEvent({
      session_id: 'sess_1',
      seq: 6,
      type: 'turn.interrupted',
      payload: { reason: 'user_interrupt', turn_id: 'turn_stop' },
    });

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({
      session_id: 'sess_1',
      reason: 'user_interrupt',
      turn_id: 'turn_stop',
      event_seq: 6,
    });
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

  it('maps complete.path to the desktop path completion endpoint without request cwd', async () => {
    const mockHttp = {
      get: vi.fn(),
      post: vi.fn().mockResolvedValue({
        items: [{ text: '@file:docs/mydoc.txt', display: 'mydoc.txt', meta: 'docs' }],
      }),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    };
    const adapter = new HttpGatewayAdapter(mockHttp as any);

    const result = await adapter.complete.path({
      partial: '@my',
      sessionId: 'sess_1',
    });

    expect(mockHttp.post).toHaveBeenCalledWith('/desktop/api/commands/complete/path', {
      word: '@my',
      session_id: 'sess_1',
    });
    expect(result).toEqual([{ text: '@file:docs/mydoc.txt', display: 'mydoc.txt', meta: 'docs' }]);
  });

  it('maps workspace and git methods to session-scoped sidecar endpoints', async () => {
    const mockHttp = {
      get: vi.fn()
        .mockResolvedValueOnce({ root: '/repo', path: '/repo', children: [], truncated: false, total_read: 0 })
        .mockResolvedValueOnce({ content: 'hello', truncated: false, binary: false, size: 5 })
        .mockResolvedValueOnce({ files: [], summary: { files_changed: 0, insertions: 0, deletions: 0 }, working_dir: '/repo' })
        .mockResolvedValueOnce({ current: 'main', branches: ['main'] }),
      post: vi.fn().mockResolvedValue({ ok: true }),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    };
    const adapter = new HttpGatewayAdapter(mockHttp as any);

    await adapter.workspace.children('sess_1', '.');
    await adapter.workspace.readFile('sess_1', 'README.md');
    await adapter.workspace.reveal('sess_1', 'README.md');
    await adapter.git.diff('sess_1');
    await adapter.git.branches('sess_1');
    await adapter.git.checkout('sess_1', 'main');

    expect(mockHttp.get).toHaveBeenNthCalledWith(
      1,
      '/desktop/api/sessions/sess_1/workspace/children?path=.',
    );
    expect(mockHttp.get).toHaveBeenNthCalledWith(
      2,
      '/desktop/api/sessions/sess_1/workspace/file?path=README.md',
    );
    expect(mockHttp.post).toHaveBeenCalledWith(
      '/desktop/api/sessions/sess_1/workspace/reveal',
      { path: 'README.md' },
    );
    expect(mockHttp.get).toHaveBeenNthCalledWith(
      3,
      '/desktop/api/sessions/sess_1/git/diff',
    );
    expect(mockHttp.get).toHaveBeenNthCalledWith(
      4,
      '/desktop/api/sessions/sess_1/git/branches',
    );
    expect(mockHttp.post).toHaveBeenCalledWith(
      '/desktop/api/sessions/sess_1/git/checkout',
      { branch: 'main' },
    );
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

describe('session.transcript', () => {
  it('fetches the canonical transcript endpoint and advances replay cursor', async () => {
    const mockHttp = {
      get: vi.fn().mockResolvedValue({
        session_id: 'sess_1',
        max_seq: 7,
        messages: [
          { id: 1, turn_id: 'turn_1', role: 'user', content: 'hi', timestamp: 1 },
          { id: 7, turn_id: 'turn_1', role: 'assistant', content: 'hello', timestamp: 2, status: 'completed' },
        ],
        live_turn: null,
      }),
      post: vi.fn(),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    };
    const adapter = new HttpGatewayAdapter(mockHttp as any);

    const transcript = await adapter.session.transcript('sess_1');

    expect(mockHttp.get).toHaveBeenCalledWith('/desktop/api/sessions/sess_1/transcript');
    expect(transcript.max_seq).toBe(7);
    expect(transcript.messages).toHaveLength(2);
    expect((adapter as any).lastSeq.get('sess_1')).toBe(7);
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
