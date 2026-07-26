import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HermesStudioBridge } from '@/shared/native-bridge.js';
import { installNativeHostMock } from '@/services/native-host.js';
import { browserSidecarInfo, HttpClient } from '../http-client';

const mockSidecarInfo = vi.fn();
let restoreHost: (() => void) | undefined;

function bridge(): HermesStudioBridge {
  return {
    backend: { info: mockSidecarInfo },
  } as unknown as HermesStudioBridge;
}

// Clear environment values so each test chooses its bridge/browser path explicitly.
beforeEach(() => {
  vi.stubEnv('VITE_SIDECAR_URL', '');
  vi.stubEnv('VITE_SIDECAR_TOKEN', '');
  restoreHost = installNativeHostMock(bridge());
});

describe('HttpClient', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    mockSidecarInfo.mockReset().mockResolvedValue({
      baseUrl: 'http://127.0.0.1:54321',
      token: 'token-A',
    });
  });

  afterEach(() => {
    restoreHost?.();
    vi.restoreAllMocks();
  });

  it('never accepts compiled browser credentials in a production build', () => {
    expect(browserSidecarInfo({
      PROD: true,
      VITE_SIDECAR_URL: 'http://127.0.0.1:18081',
      VITE_SIDECAR_TOKEN: 'prod-secret',
    })).toBeNull();
  });

  it('prepends Electron bridge base URL and Authorization', async () => {
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

  it('prefers Electron backend info over browser-development env vars', async () => {
    vi.stubEnv('VITE_SIDECAR_URL', 'http://127.0.0.1:9999');
    vi.stubEnv('VITE_SIDECAR_TOKEN', 'env-token');
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    const c = new HttpClient();
    await c.get('/desktop/api/health');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:54321/desktop/api/health');
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: 'Bearer token-A',
    });
  });

  it('uses explicit env vars only when the native bridge is absent', async () => {
    vi.stubEnv('VITE_SIDECAR_URL', 'http://127.0.0.1:9999');
    vi.stubEnv('VITE_SIDECAR_TOKEN', 'env-token');
    restoreHost?.();
    restoreHost = installNativeHostMock(null);
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    const c = new HttpClient();
    await c.get('/desktop/api/health');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://127.0.0.1:9999/desktop/api/health');
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: 'Bearer env-token',
    });
  });

  it('does not downgrade to compiled env credentials when Electron backend discovery fails', async () => {
    vi.stubEnv('VITE_SIDECAR_URL', 'http://127.0.0.1:9999');
    vi.stubEnv('VITE_SIDECAR_TOKEN', 'fixed-token');
    mockSidecarInfo.mockRejectedValueOnce(new Error('sidecar not ready'));
    const c = new HttpClient();

    await expect(c.get('/desktop/api/health')).rejects.toThrow('sidecar not ready');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('retries GET 3x on network error', async () => {
    fetchMock.mockRejectedValue(new TypeError('network'));
    const c = new HttpClient();
    await expect(c.get('/x')).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('does NOT retry PATCH on network error', async () => {
    fetchMock.mockRejectedValue(new TypeError('network'));
    const c = new HttpClient();
    await expect(c.patch('/x', { a: 1 })).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('on 401 refetches backend coordinates then retries once', async () => {
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
      .mockResolvedValueOnce({ baseUrl: 'http://127.0.0.1:54321', token: 'old' })
      .mockResolvedValueOnce({ baseUrl: 'http://127.0.0.1:65432', token: 'new' });
    const c = new HttpClient();
    const out = await c.get('/x');
    expect(out).toEqual({ ok: true });
    const second = fetchMock.mock.calls[1][1] as RequestInit;
    expect(fetchMock.mock.calls[1][0]).toBe('http://127.0.0.1:65432/x');
    expect(second.headers).toMatchObject({ Authorization: 'Bearer new' });
  });

  it('accepts fresh backend coordinates from a native restart event', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    const c = new HttpClient();
    c.updateBackendInfo({ baseUrl: 'http://127.0.0.1:65432', token: 'restarted' });

    await c.get('/desktop/api/health');

    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://127.0.0.1:65432/desktop/api/health');
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit).headers).toMatchObject({
      Authorization: 'Bearer restarted',
    });
    expect(mockSidecarInfo).not.toHaveBeenCalled();
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
