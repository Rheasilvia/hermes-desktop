import { describe, expect, it, vi } from 'vitest';
import { GatewayClient } from '../client.js';
import type { Transport } from '../transport.js';

function makeTransport(response: unknown): Transport & { send: ReturnType<typeof vi.fn> } {
  return {
    send: vi.fn().mockResolvedValue(response),
    onMessage: vi.fn(),
    close: vi.fn(),
  };
}

describe('GatewayClient complete.path', () => {
  it('serializes word and session_id without request cwd', async () => {
    const transport = makeTransport({ items: [] });
    const client = new GatewayClient(transport);

    await client.complete.path({
      partial: '@file:sr',
      sessionId: 'session-a',
    });

    expect(transport.send).toHaveBeenCalledWith('complete.path', {
      word: '@file:sr',
      session_id: 'session-a',
    });
  });

  it('unwraps backend items', async () => {
    const transport = makeTransport({
      items: [{ text: '@file:src/main.ts', display: 'main.ts', meta: 'src' }],
    });
    const client = new GatewayClient(transport);

    await expect(client.complete.path({ partial: '@file:sr', sessionId: 'session-a' })).resolves.toEqual([
      { text: '@file:src/main.ts', display: 'main.ts', meta: 'src' },
    ]);
  });

  it('normalizes malformed responses to an empty list', async () => {
    const transport = makeTransport({ nope: true });
    const client = new GatewayClient(transport);

    await expect(client.complete.path({ partial: '@file:sr', sessionId: 'session-a' })).resolves.toEqual([]);
  });
});

describe('GatewayClient session.steer', () => {
  it('serializes session_id and text', async () => {
    const transport = makeTransport({ status: 'queued', text: 'nudge the run' });
    const client = new GatewayClient(transport);

    await expect(client.session.steer('session-a', 'nudge the run')).resolves.toEqual({
      status: 'queued',
      text: 'nudge the run',
    });

    expect(transport.send).toHaveBeenCalledWith('session.steer', {
      session_id: 'session-a',
      text: 'nudge the run',
    });
  });
});
