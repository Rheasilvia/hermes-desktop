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
  it('emits tool.progress event (was silently dropped)', () => {
    const adapter = makeAdapter();
    const received: unknown[] = [];
    adapter.on('tool.progress', (payload) => received.push(payload));

    (adapter as any).dispatchSseEvent({
      session_id: 'sess_1',
      seq: 2,
      type: 'tool.progress',
      payload: { name: 'web_search', preview: '3/10 results fetched' },
    });

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ name: 'web_search', preview: '3/10 results fetched' });
  });
});
