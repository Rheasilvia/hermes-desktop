import { describe, expect, it, vi } from 'vitest';
import type { HttpClient } from '@/services/api/http-client.js';
import { resolveEventSourceUrl } from './sse-lifecycle.js';

describe('resolveEventSourceUrl', () => {
  it('uses the authenticated backend info exposed by HttpClient', async () => {
    const backendInfo = vi.fn(async () => ({
      base_url: 'http://127.0.0.1:43123',
      token: 'fresh token',
    }));

    await expect(resolveEventSourceUrl({ backendInfo } as unknown as HttpClient))
      .resolves.toBe('http://127.0.0.1:43123/desktop/api/events/stream?token=fresh%20token');
    expect(backendInfo).toHaveBeenCalledOnce();
  });

  it('fails closed instead of falling back to a fixed default after discovery failure', async () => {
    const backendInfo = vi.fn(async () => { throw new Error('native backend unavailable'); });

    await expect(resolveEventSourceUrl({ backendInfo } as unknown as HttpClient))
      .rejects.toThrow('native backend unavailable');
  });
});
