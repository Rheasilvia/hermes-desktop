import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpClient } from '../http-client';

const mockSidecarInfo = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (cmd: string) => {
    if (cmd === 'sidecar_info') return mockSidecarInfo();
    throw new Error(`unexpected invoke: ${cmd}`);
  },
}));

describe('HttpClient', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    mockSidecarInfo.mockResolvedValue({
      base_url: 'http://127.0.0.1:54321',
      token: 'token-A',
    });
  });

  afterEach(() => vi.restoreAllMocks());

  it('prepends base url + Authorization', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    const c = new HttpClient();
    await c.get('/desktop/api/cron/jobs');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:54321/desktop/api/cron/jobs');
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: 'Bearer token-A',
    });
  });

  it('retries GET 3x on network error', async () => {
    fetchMock.mockRejectedValue(new TypeError('network'));
    const c = new HttpClient();
    await expect(c.get('/x')).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(4); // 1 + 3 retries
  });

  it('does NOT retry PATCH on network error', async () => {
    fetchMock.mockRejectedValue(new TypeError('network'));
    const c = new HttpClient();
    await expect(c.patch('/x', { a: 1 })).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('on 401 refetches token then retries once', async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ code: 'AUTH_FAILED', trace_id: 't' }), {
          status: 401,
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), { status: 200 }),
      );
    mockSidecarInfo
      .mockResolvedValueOnce({ base_url: 'http://127.0.0.1:54321', token: 'old' })
      .mockResolvedValueOnce({ base_url: 'http://127.0.0.1:54321', token: 'new' });
    const c = new HttpClient();
    const out = await c.get('/x');
    expect(out).toEqual({ ok: true });
    const second = fetchMock.mock.calls[1][1] as RequestInit;
    expect(second.headers).toMatchObject({ Authorization: 'Bearer new' });
  });

  it('parses error envelope into ApiError', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          code: 'L1_CORRUPT',
          domain: 'cron',
          path: '/x/jobs.json',
          trace_id: 'abc',
        }),
        { status: 503 },
      ),
    );
    const c = new HttpClient();
    await expect(c.get('/cron/jobs')).rejects.toMatchObject({
      code: 'L1_CORRUPT',
      domain: 'cron',
      path: '/x/jobs.json',
      traceId: 'abc',
    });
  });
});
