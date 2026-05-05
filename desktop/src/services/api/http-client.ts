import { invoke } from '@tauri-apps/api/core';
import type { ApiError } from './types';

interface SidecarInfo {
  base_url: string;
  token: string;
}

const RETRY_DELAYS_MS = [100, 300, 700];

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function makeApiError(
  code: string,
  message: string,
  traceId: string,
  domain?: string,
  path?: string,
): ApiError {
  const e = new Error(message) as ApiError;
  e.code = code;
  e.traceId = traceId;
  if (domain) e.domain = domain;
  if (path) e.path = path;
  return e;
}

export class HttpClient {
  private cached: SidecarInfo | null = null;

  private async info(force = false): Promise<SidecarInfo> {
    if (!this.cached || force) {
      this.cached = (await invoke('sidecar_info')) as SidecarInfo;
    }
    return this.cached;
  }

  private async send(
    path: string,
    init: RequestInit,
    opts: { retryNetwork: boolean; retryAuthOnce: boolean },
  ): Promise<unknown> {
    const info = await this.info();
    const url = `${info.base_url}${path}`;
    const merged: RequestInit = {
      ...init,
      headers: {
        Authorization: `Bearer ${info.token}`,
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
    };

    let attempt = 0;
    let lastError: unknown;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      try {
        const resp = await fetch(url, merged);
        if (resp.status === 401 && opts.retryAuthOnce) {
          opts.retryAuthOnce = false;
          const fresh = await this.info(true);
          (merged.headers as Record<string, string>).Authorization =
            `Bearer ${fresh.token}`;
          continue;
        }
        if (!resp.ok) {
          let body: Record<string, unknown> = {};
          try {
            body = (await resp.json()) as Record<string, unknown>;
          } catch {
            // non-JSON body
          }
          throw makeApiError(
            String(body.code ?? `HTTP_${resp.status}`),
            String(body.detail ?? resp.statusText),
            String(body.trace_id ?? 'unknown'),
            body.domain as string | undefined,
            body.path as string | undefined,
          );
        }
        return await resp.json();
      } catch (err) {
        lastError = err;
        const isNetwork = err instanceof TypeError;
        if (
          opts.retryNetwork &&
          isNetwork &&
          attempt < RETRY_DELAYS_MS.length
        ) {
          await delay(RETRY_DELAYS_MS[attempt]);
          attempt += 1;
          continue;
        }
        throw lastError;
      }
    }
  }

  get<T>(path: string): Promise<T> {
    return this.send(
      path,
      { method: 'GET' },
      { retryNetwork: true, retryAuthOnce: true },
    ) as Promise<T>;
  }

  patch<T>(path: string, body: unknown): Promise<T> {
    return this.send(
      path,
      { method: 'PATCH', body: JSON.stringify(body) },
      { retryNetwork: false, retryAuthOnce: true },
    ) as Promise<T>;
  }

  put<T>(path: string, body: unknown): Promise<T> {
    return this.send(
      path,
      { method: 'PUT', body: JSON.stringify(body) },
      { retryNetwork: false, retryAuthOnce: true },
    ) as Promise<T>;
  }
}

export const httpClient = new HttpClient();
