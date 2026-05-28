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
  extra?: Record<string, unknown>,
): ApiError {
  const e = new Error(message) as ApiError;
  e.code = code;
  e.traceId = traceId;
  if (domain) e.domain = domain;
  if (path) e.path = path;
  if (extra) e.extra = extra;
  return e;
}

function envSidecarInfo(): SidecarInfo | null {
  const url = import.meta.env.VITE_SIDECAR_URL;
  const token = import.meta.env.VITE_SIDECAR_TOKEN;
  if (url && token) {
    return { base_url: url, token };
  }
  return null;
}

async function tauriSidecarInfo(): Promise<SidecarInfo | null> {
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return (await invoke('sidecar_info')) as SidecarInfo;
  } catch {
    return null;
  }
}

export class HttpClient {
  private cached: SidecarInfo | null = null;

  private async info(force = false): Promise<SidecarInfo> {
    if (!this.cached || force) {
      // 优先使用 env vars（开发调试用）
      const env = envSidecarInfo();
      if (env) {
        this.cached = env;
        return this.cached;
      }
      // 其次尝试 Tauri sidecar_info
      const tauri = await tauriSidecarInfo();
      if (tauri) {
        this.cached = tauri;
        return this.cached;
      }
      throw new Error(
        'No sidecar available. Set VITE_SIDECAR_URL and VITE_SIDECAR_TOKEN, or run inside Tauri.',
      );
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
            // Carry any non-standard fields (e.g. memory's 409 `current`).
            (() => {
              const extra: Record<string, unknown> = {};
              const known = new Set(['code', 'detail', 'trace_id', 'domain', 'path']);
              for (const [k, v] of Object.entries(body)) {
                if (!known.has(k)) extra[k] = v;
              }
              return Object.keys(extra).length > 0 ? extra : undefined;
            })(),
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

  put<T>(path: string, body: unknown, headers?: Record<string, string>): Promise<T> {
    return this.send(
      path,
      { method: 'PUT', body: JSON.stringify(body), headers },
      { retryNetwork: false, retryAuthOnce: true },
    ) as Promise<T>;
  }

  post<T>(path: string, body: unknown): Promise<T> {
    return this.send(
      path,
      { method: 'POST', body: JSON.stringify(body) },
      { retryNetwork: false, retryAuthOnce: true },
    ) as Promise<T>;
  }

  delete<T>(path: string): Promise<T> {
    return this.send(
      path,
      { method: 'DELETE' },
      { retryNetwork: false, retryAuthOnce: true },
    ) as Promise<T>;
  }
}

export const httpClient = new HttpClient();
