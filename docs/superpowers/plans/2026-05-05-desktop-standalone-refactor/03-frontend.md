# 03 — Frontend services/api + stores + module wiring (Tasks 23–33)

> Implements spec sections `01-architecture.md §"Frontend tree"`,
> `02-data-flow.md §"Read flow / Write flow"`, and
> `03-error-handling.md §"Frontend lost connection / Token rotation"`.
>
> Working directory: `desktop/`.

---

## Task 23: `services/api/types.ts` — shared types

**Files:**
- Create: `desktop/src/services/api/types.ts`
- Create: `desktop/src/services/api/__tests__/types.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/services/api/__tests__/types.test.ts
import { describe, expect, it } from 'vitest';
import type {
  CronJob,
  CronOverlay,
  ListResponse,
  Provider,
  Settings,
} from '../types';
import { isApiError } from '../types';

describe('types', () => {
  it('isApiError narrows', () => {
    const e: unknown = Object.assign(new Error('x'), {
      code: 'L1_CORRUPT',
      traceId: 't',
      domain: 'cron',
    });
    expect(isApiError(e)).toBe(true);
  });

  it('plain Error is not ApiError', () => {
    expect(isApiError(new Error('x'))).toBe(false);
  });

  it('compile-time shape check', () => {
    const c: CronJob = {
      id: 'job_test_001',
      schedule: '0 9 * * *',
      prompt: 'p',
      enabled: true,
      created_at: '2026-05-05T09:00:00Z',
      desktop: { pinned: false } satisfies CronOverlay,
    };
    const list: ListResponse<CronJob> = { items: [c], generated_at: null };
    const p: Provider = {
      id: 'provider_test_anthropic',
      name: 'Anthropic',
      models: [],
      desktop: { visible: true },
    };
    const s: Settings = { schema_version: 1, ui: {} };
    expect(list.items[0].id).toBe('job_test_001');
    expect(p.desktop.visible).toBe(true);
    expect(s.schema_version).toBe(1);
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

```bash
npx vitest run src/services/api/__tests__/types.test.ts
```

- [ ] **Step 3: Implement `types.ts`**

```ts
// src/services/api/types.ts
export interface CronOverlay {
  pinned: boolean;
  color?: string | null;
  note?: string | null;
  updated_at?: string | null;
}

export interface CronJob {
  id: string;
  schedule: string;
  prompt: string;
  enabled: boolean;
  created_at: string;
  desktop: CronOverlay;
}

export interface ProviderOverlay {
  visible: boolean;
  display_order?: number | null;
  note?: string | null;
  updated_at?: string | null;
}

export interface Provider {
  id: string;
  name: string;
  auth?: string | null;
  models: Array<Record<string, unknown>>;
  desktop: ProviderOverlay;
}

export interface Settings {
  schema_version: number;
  ui: Record<string, unknown>;
}

export interface State {
  schema_version: number;
  last_open_route: string;
  window: Record<string, unknown>;
}

export interface ListResponse<T> {
  items: T[];
  generated_at: string | null;
}

export type ErrorCode =
  | 'AUTH_FAILED'
  | 'NOT_FOUND'
  | 'SCHEMA_VERSION'
  | 'VALIDATION'
  | 'LOCKED'
  | 'INTERNAL'
  | 'L1_CORRUPT'
  | 'L1_MISSING_DIR'
  | 'SIDECAR_DOWN';

export interface ApiError extends Error {
  code: ErrorCode | string;
  domain?: string;
  path?: string;
  traceId: string;
}

export function isApiError(e: unknown): e is ApiError {
  return (
    e instanceof Error &&
    typeof (e as { code?: unknown }).code === 'string' &&
    typeof (e as { traceId?: unknown }).traceId === 'string'
  );
}

export type Domain = 'cron' | 'model' | 'overlays' | 'settings' | 'state';
```

- [ ] **Step 4: Run, expect PASS**

- [ ] **Step 5: Commit**

```bash
git add desktop/src/services/api/types.ts desktop/src/services/api/__tests__/types.test.ts
git commit -m "feat(desktop-api): shared types + ApiError helper"
```

---

## Task 24: `services/api/http-client.ts`

**Files:**
- Create: `desktop/src/services/api/http-client.ts`
- Create: `desktop/src/services/api/__tests__/http-client.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/services/api/__tests__/http-client.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpClient } from '../http-client';

const mockSidecarInfo = vi.fn();

vi.mock('@tauri-apps/api/tauri', () => ({
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

  it('retries GET 3× on network error', async () => {
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
```

- [ ] **Step 2: Run, expect FAIL**

- [ ] **Step 3: Implement `http-client.ts`**

```ts
// src/services/api/http-client.ts
import { invoke } from '@tauri-apps/api/tauri';
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
```

- [ ] **Step 4: Run, expect PASS**

- [ ] **Step 5: Commit**

```bash
git add desktop/src/services/api/http-client.ts desktop/src/services/api/__tests__/http-client.test.ts
git commit -m "feat(desktop-api): http-client with retry, auth refresh, error envelope"
```

---

## Task 25: HTTP transports

**Files:**
- Create: `desktop/src/services/api/transports/http/cron.ts`
- Create: `desktop/src/services/api/transports/http/model.ts`
- Create: `desktop/src/services/api/transports/http/overlays.ts`
- Create: `desktop/src/services/api/transports/http/settings.ts`
- Create: `desktop/src/services/api/transports/http/state.ts`
- Create: `desktop/src/services/api/transports/http/__tests__/cron.test.ts`
- Create: `desktop/src/services/api/transports/http/__tests__/overlays.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// src/services/api/transports/http/__tests__/cron.test.ts
import { describe, expect, it, vi } from 'vitest';
import { makeCronTransport } from '../cron';

describe('cron http transport', () => {
  it('list calls GET /cron/jobs', async () => {
    const client = {
      get: vi.fn().mockResolvedValue({ items: [], generated_at: null }),
    };
    const t = makeCronTransport(client as never);
    await t.list();
    expect(client.get).toHaveBeenCalledWith('/desktop/api/cron/jobs');
  });

  it('get calls GET /cron/jobs/:id', async () => {
    const client = { get: vi.fn().mockResolvedValue({ id: 'job_test_001' }) };
    const t = makeCronTransport(client as never);
    const out = await t.get('job_test_001');
    expect(client.get).toHaveBeenCalledWith(
      '/desktop/api/cron/jobs/job_test_001',
    );
    expect(out.id).toBe('job_test_001');
  });
});
```

```ts
// src/services/api/transports/http/__tests__/overlays.test.ts
import { describe, expect, it, vi } from 'vitest';
import { makeOverlayTransport } from '../overlays';

describe('overlays http transport', () => {
  it('patch builds correct path + body', async () => {
    const client = { patch: vi.fn().mockResolvedValue({ pinned: true }) };
    const t = makeOverlayTransport(client as never);
    await t.patch('cron', 'job_test_001', { pinned: true });
    expect(client.patch).toHaveBeenCalledWith(
      '/desktop/api/overlays/cron/job_test_001',
      { pinned: true },
    );
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

- [ ] **Step 3: Implement transports**

```ts
// src/services/api/transports/http/cron.ts
import type { HttpClient } from '../../http-client';
import type { CronJob, ListResponse } from '../../types';

export interface CronTransport {
  list(): Promise<ListResponse<CronJob>>;
  get(id: string): Promise<CronJob>;
}

export function makeCronTransport(c: HttpClient): CronTransport {
  return {
    list: () => c.get<ListResponse<CronJob>>('/desktop/api/cron/jobs'),
    get: (id) => c.get<CronJob>(`/desktop/api/cron/jobs/${id}`),
  };
}
```

```ts
// src/services/api/transports/http/model.ts
import type { HttpClient } from '../../http-client';
import type { ListResponse, Provider } from '../../types';

export interface ModelTransport {
  listProviders(): Promise<ListResponse<Provider>>;
  getCatalog(): Promise<{ providers: Provider[]; fetched_at: string | null }>;
}

export function makeModelTransport(c: HttpClient): ModelTransport {
  return {
    listProviders: () =>
      c.get<ListResponse<Provider>>('/desktop/api/model/providers'),
    getCatalog: () =>
      c.get<{ providers: Provider[]; fetched_at: string | null }>(
        '/desktop/api/model/catalog',
      ),
  };
}
```

```ts
// src/services/api/transports/http/overlays.ts
import type { HttpClient } from '../../http-client';

export interface OverlayTransport {
  patch(
    domain: 'cron' | 'model',
    entityId: string,
    body: Record<string, unknown>,
  ): Promise<Record<string, unknown>>;
}

export function makeOverlayTransport(c: HttpClient): OverlayTransport {
  return {
    patch: (domain, id, body) =>
      c.patch(`/desktop/api/overlays/${domain}/${id}`, body),
  };
}
```

```ts
// src/services/api/transports/http/settings.ts
import type { HttpClient } from '../../http-client';
import type { Settings } from '../../types';

export interface SettingsTransport {
  get(): Promise<Settings>;
  put(s: Settings): Promise<Settings>;
}

export function makeSettingsTransport(c: HttpClient): SettingsTransport {
  return {
    get: () => c.get<Settings>('/desktop/api/settings'),
    put: (s) => c.put<Settings>('/desktop/api/settings', s),
  };
}
```

```ts
// src/services/api/transports/http/state.ts
import type { HttpClient } from '../../http-client';
import type { State } from '../../types';

export interface StateTransport {
  get(): Promise<State>;
  put(s: State): Promise<State>;
}

export function makeStateTransport(c: HttpClient): StateTransport {
  return {
    get: () => c.get<State>('/desktop/api/state'),
    put: (s) => c.put<State>('/desktop/api/state', s),
  };
}
```

- [ ] **Step 4: Run, expect PASS**

- [ ] **Step 5: Commit**

```bash
git add desktop/src/services/api/transports/http
git commit -m "feat(desktop-api): http transports for cron/model/overlays/settings/state"
```

---

## Task 26: Mock transports

**Files:**
- Create: `desktop/src/services/api/transports/mock/cron.ts`
- Create: `desktop/src/services/api/transports/mock/model.ts`
- Create: `desktop/src/services/api/transports/mock/overlays.ts`
- Create: `desktop/src/services/api/transports/mock/settings.ts`
- Create: `desktop/src/services/api/transports/mock/state.ts`

- [ ] **Step 1: Implement (no unit tests; exercised by E2E)**

```ts
// src/services/api/transports/mock/cron.ts
import type { CronTransport } from '../http/cron';
import type { CronJob, ListResponse } from '../../types';

const SEED: CronJob[] = [
  {
    id: 'job_test_001',
    schedule: '0 9 * * *',
    prompt: 'morning briefing',
    enabled: true,
    created_at: '2026-05-05T09:00:00Z',
    desktop: { pinned: false },
  },
  {
    id: 'job_test_002',
    schedule: '*/5 * * * *',
    prompt: 'poll',
    enabled: false,
    created_at: '2026-05-05T09:00:00Z',
    desktop: { pinned: false },
  },
];

export function makeMockCronTransport(): CronTransport {
  let store = SEED.map((j) => ({ ...j, desktop: { ...j.desktop } }));
  return {
    list: async (): Promise<ListResponse<CronJob>> => ({
      items: store.map((j) => ({ ...j, desktop: { ...j.desktop } })),
      generated_at: '2026-05-05T09:00:00Z',
    }),
    get: async (id) => {
      const found = store.find((j) => j.id === id);
      if (!found) {
        const e = new Error('not found') as Error & {
          code: string;
          traceId: string;
        };
        e.code = 'NOT_FOUND';
        e.traceId = 'mock';
        throw e;
      }
      return { ...found, desktop: { ...found.desktop } };
    },
  };
}
```

```ts
// src/services/api/transports/mock/model.ts
import type { ModelTransport } from '../http/model';
import type { Provider } from '../../types';

const SEED: Provider[] = [
  {
    id: 'provider_test_anthropic',
    name: 'Anthropic',
    auth: 'api_key',
    models: [{ id: 'claude-sonnet-4', context_window: 200000 }],
    desktop: { visible: true },
  },
  {
    id: 'provider_test_openai',
    name: 'OpenAI',
    auth: 'api_key',
    models: [{ id: 'gpt-5', context_window: 128000 }],
    desktop: { visible: true },
  },
];

export function makeMockModelTransport(): ModelTransport {
  return {
    listProviders: async () => ({
      items: SEED.map((p) => ({ ...p, desktop: { ...p.desktop } })),
      generated_at: '2026-05-05T09:00:00Z',
    }),
    getCatalog: async () => ({
      providers: SEED.map((p) => ({ ...p, desktop: { ...p.desktop } })),
      fetched_at: '2026-05-05T09:00:00Z',
    }),
  };
}
```

```ts
// src/services/api/transports/mock/overlays.ts
import type { OverlayTransport } from '../http/overlays';

export function makeMockOverlayTransport(): OverlayTransport {
  return {
    patch: async (_domain, _id, body) => ({ ...body }),
  };
}
```

```ts
// src/services/api/transports/mock/settings.ts
import type { SettingsTransport } from '../http/settings';
import type { Settings } from '../../types';

export function makeMockSettingsTransport(): SettingsTransport {
  let s: Settings = { schema_version: 1, ui: { theme: 'system' } };
  return {
    get: async () => ({ ...s }),
    put: async (next) => {
      s = { ...next };
      return { ...s };
    },
  };
}
```

```ts
// src/services/api/transports/mock/state.ts
import type { StateTransport } from '../http/state';
import type { State } from '../../types';

export function makeMockStateTransport(): StateTransport {
  let s: State = { schema_version: 1, last_open_route: '/', window: {} };
  return {
    get: async () => ({ ...s }),
    put: async (next) => {
      s = { ...next };
      return { ...s };
    },
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add desktop/src/services/api/transports/mock
git commit -m "feat(desktop-api): mock transports for E2E + storybook"
```

---

## Task 27: `services/api/router.ts` + `index.ts`

**Files:**
- Create: `desktop/src/services/api/router.ts`
- Create: `desktop/src/services/api/index.ts`
- Create: `desktop/src/services/api/__tests__/router.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/services/api/__tests__/router.test.ts
import { describe, expect, it } from 'vitest';
import { ApiRegistry } from '../router';

describe('ApiRegistry', () => {
  it('resolves registered transports', () => {
    const reg = new ApiRegistry();
    const cron = {
      list: async () => ({ items: [], generated_at: null }),
      get: async () => ({}) as never,
    };
    reg.register('cron', cron);
    expect(reg.cron()).toBe(cron);
  });

  it('throws on unknown domain', () => {
    const reg = new ApiRegistry();
    expect(() => reg.cron()).toThrowError(/cron/);
  });

  it('swap replaces resolution', () => {
    const reg = new ApiRegistry();
    const a = {
      list: async () => ({ items: [], generated_at: null }),
      get: async () => ({}) as never,
    };
    const b = {
      list: async () => ({ items: [], generated_at: null }),
      get: async () => ({}) as never,
    };
    reg.register('cron', a);
    reg.register('cron', b);
    expect(reg.cron()).toBe(b);
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

- [ ] **Step 3: Implement registry + index**

```ts
// src/services/api/router.ts
import type { CronTransport } from './transports/http/cron';
import type { ModelTransport } from './transports/http/model';
import type { OverlayTransport } from './transports/http/overlays';
import type { SettingsTransport } from './transports/http/settings';
import type { StateTransport } from './transports/http/state';

type Slot =
  | { kind: 'cron'; impl: CronTransport }
  | { kind: 'model'; impl: ModelTransport }
  | { kind: 'overlays'; impl: OverlayTransport }
  | { kind: 'settings'; impl: SettingsTransport }
  | { kind: 'state'; impl: StateTransport };

export class ApiRegistry {
  private slots: Map<Slot['kind'], unknown> = new Map();

  register<K extends Slot['kind']>(
    kind: K,
    impl: Extract<Slot, { kind: K }>['impl'],
  ): void {
    this.slots.set(kind, impl);
  }

  private resolve<T>(kind: Slot['kind']): T {
    const v = this.slots.get(kind);
    if (!v) throw new Error(`No transport registered for ${kind}`);
    return v as T;
  }

  cron(): CronTransport {
    return this.resolve<CronTransport>('cron');
  }
  model(): ModelTransport {
    return this.resolve<ModelTransport>('model');
  }
  overlays(): OverlayTransport {
    return this.resolve<OverlayTransport>('overlays');
  }
  settings(): SettingsTransport {
    return this.resolve<SettingsTransport>('settings');
  }
  state(): StateTransport {
    return this.resolve<StateTransport>('state');
  }
}

export const api = new ApiRegistry();
```

```ts
// src/services/api/index.ts
import { api } from './router';
import { httpClient } from './http-client';
import { makeCronTransport } from './transports/http/cron';
import { makeModelTransport } from './transports/http/model';
import { makeOverlayTransport } from './transports/http/overlays';
import { makeSettingsTransport } from './transports/http/settings';
import { makeStateTransport } from './transports/http/state';

import { makeMockCronTransport } from './transports/mock/cron';
import { makeMockModelTransport } from './transports/mock/model';
import { makeMockOverlayTransport } from './transports/mock/overlays';
import { makeMockSettingsTransport } from './transports/mock/settings';
import { makeMockStateTransport } from './transports/mock/state';

export type {
  CronJob,
  Provider,
  Settings,
  State,
  ListResponse,
  ApiError,
} from './types';
export { api } from './router';
export { isApiError } from './types';

export function bootstrapApi(mode: 'http' | 'mock' = 'http'): void {
  if (mode === 'mock') {
    api.register('cron', makeMockCronTransport());
    api.register('model', makeMockModelTransport());
    api.register('overlays', makeMockOverlayTransport());
    api.register('settings', makeMockSettingsTransport());
    api.register('state', makeMockStateTransport());
    return;
  }
  api.register('cron', makeCronTransport(httpClient));
  api.register('model', makeModelTransport(httpClient));
  api.register('overlays', makeOverlayTransport(httpClient));
  api.register('settings', makeSettingsTransport(httpClient));
  api.register('state', makeStateTransport(httpClient));
}
```

- [ ] **Step 4: Run, expect PASS**

- [ ] **Step 5: Commit**

```bash
git add desktop/src/services/api/router.ts desktop/src/services/api/index.ts desktop/src/services/api/__tests__/router.test.ts
git commit -m "feat(desktop-api): router + bootstrap (http | mock)"
```

---

## Task 28: Bootstrap on app startup

**Files:**
- Modify: `desktop/src/main.tsx` (SolidJS entry — adjust if filename differs)
- Create: `desktop/.env.development`
- Create: `desktop/.env.test`

- [ ] **Step 1: Add bootstrap call** — at the top of `main.tsx`, before
mounting the SolidJS root:

```ts
import { bootstrapApi } from './services/api';
const apiMode = import.meta.env.VITE_API_MODE === 'mock' ? 'mock' : 'http';
bootstrapApi(apiMode);
```

- [ ] **Step 2: Add env files**

```
# desktop/.env.development
VITE_API_MODE=http
```

```
# desktop/.env.test
VITE_API_MODE=mock
```

- [ ] **Step 3: Commit**

```bash
git add desktop/src/main.tsx desktop/.env.development desktop/.env.test
git commit -m "feat(desktop): bootstrap api router from env at startup"
```

---

## Task 29: `stores/cron.ts` — new SolidJS store

**Files:**
- Create: `desktop/src/stores/cron.ts`
- Create: `desktop/src/stores/__tests__/cron.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/stores/__tests__/cron.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../services/api/router';
import { createCronStore } from '../cron';

beforeEach(() => {
  api.register('cron', {
    list: vi.fn().mockResolvedValue({
      items: [
        {
          id: 'job_test_001',
          schedule: '0 9 * * *',
          prompt: 'p',
          enabled: true,
          created_at: '2026-05-05T09:00:00Z',
          desktop: { pinned: false },
        },
      ],
      generated_at: '2026-05-05T09:00:00Z',
    }),
    get: vi.fn(),
  });
  api.register('overlays', {
    patch: vi.fn().mockResolvedValue({ pinned: true }),
  });
});

describe('cron store', () => {
  it('load() populates jobs', async () => {
    const s = createCronStore();
    await s.load();
    expect(s.jobs().length).toBe(1);
    expect(s.loading()).toBe(false);
    expect(s.error()).toBeNull();
  });

  it('togglePinned applies optimistic update + persists', async () => {
    const s = createCronStore();
    await s.load();
    await s.togglePinned('job_test_001');
    expect(s.jobs()[0].desktop.pinned).toBe(true);
  });

  it('togglePinned rolls back on PATCH failure', async () => {
    api.register('overlays', {
      patch: vi.fn().mockRejectedValue(
        Object.assign(new Error('x'), { code: 'INTERNAL', traceId: 't' }),
      ),
    });
    const s = createCronStore();
    await s.load();
    await expect(s.togglePinned('job_test_001')).rejects.toThrow();
    expect(s.jobs()[0].desktop.pinned).toBe(false);
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

- [ ] **Step 3: Implement `stores/cron.ts`**

```ts
// src/stores/cron.ts
import { createSignal } from 'solid-js';
import { api } from '../services/api/router';
import type { CronJob } from '../services/api/types';

export interface CronStore {
  jobs: () => CronJob[];
  loading: () => boolean;
  error: () => Error | null;
  load: () => Promise<void>;
  togglePinned: (id: string) => Promise<void>;
}

export function createCronStore(): CronStore {
  const [jobs, setJobs] = createSignal<CronJob[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<Error | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await api.cron().list();
      setJobs(resp.items);
    } catch (e) {
      setError(e as Error);
      // keep last successful jobs in place
    } finally {
      setLoading(false);
    }
  };

  const togglePinned = async (id: string) => {
    const prev = jobs();
    const idx = prev.findIndex((j) => j.id === id);
    if (idx < 0) return;
    const target = prev[idx];
    const optimistic: CronJob = {
      ...target,
      desktop: { ...target.desktop, pinned: !target.desktop.pinned },
    };
    setJobs(prev.map((j, i) => (i === idx ? optimistic : j)));
    try {
      await api
        .overlays()
        .patch('cron', id, { pinned: optimistic.desktop.pinned });
    } catch (e) {
      setJobs(prev);
      throw e;
    }
  };

  return { jobs, loading, error, load, togglePinned };
}

export const cronStore = createCronStore();
```

- [ ] **Step 4: Run, expect PASS**

- [ ] **Step 5: Commit**

```bash
git add desktop/src/stores/cron.ts desktop/src/stores/__tests__/cron.test.ts
git commit -m "feat(desktop-store): cron store backed by services/api"
```

---

## Task 30: Refactor `stores/models.ts` to use `api.model()`

**Files:**
- Modify: `desktop/src/stores/models.ts`
- Create: `desktop/src/stores/__tests__/models.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/stores/__tests__/models.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../services/api/router';
import { createModelsStore } from '../models';

beforeEach(() => {
  api.register('model', {
    listProviders: vi.fn().mockResolvedValue({
      items: [
        {
          id: 'provider_test_anthropic',
          name: 'Anthropic',
          auth: 'api_key',
          models: [{ id: 'claude-sonnet-4', context_window: 200000 }],
          desktop: { visible: true },
        },
      ],
      generated_at: '2026-05-05T09:00:00Z',
    }),
    getCatalog: vi.fn(),
  });
});

describe('models store', () => {
  it('load() populates providers', async () => {
    const s = createModelsStore();
    await s.load();
    expect(s.providers().length).toBe(1);
    expect(s.providers()[0].id).toBe('provider_test_anthropic');
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

- [ ] **Step 3: Refactor `stores/models.ts`**

Replace the existing in-file mock array with:

```ts
// src/stores/models.ts
import { createSignal } from 'solid-js';
import { api } from '../services/api/router';
import type { Provider } from '../services/api/types';

export interface ModelsStore {
  providers: () => Provider[];
  loading: () => boolean;
  error: () => Error | null;
  load: () => Promise<void>;
}

export function createModelsStore(): ModelsStore {
  const [providers, setProviders] = createSignal<Provider[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<Error | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await api.model().listProviders();
      setProviders(resp.items);
    } catch (e) {
      setError(e as Error);
    } finally {
      setLoading(false);
    }
  };

  return { providers, loading, error, load };
}

export const modelsStore = createModelsStore();
```

> If `stores/models.ts` previously exported additional helpers
> (selection / filtering), keep their *signatures* and re-implement on
> top of `providers()`. Do not change consumer APIs.

- [ ] **Step 4: Run, expect PASS**

- [ ] **Step 5: Commit**

```bash
git add desktop/src/stores/models.ts desktop/src/stores/__tests__/models.test.ts
git commit -m "refactor(desktop-store): models store sources from services/api"
```

---

## Task 31: Refactor `stores/settings.ts` to use `api.settings()`

**Files:**
- Modify: `desktop/src/stores/settings.ts`
- Create: `desktop/src/stores/__tests__/settings.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/stores/__tests__/settings.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../services/api/router';
import { createSettingsStore } from '../settings';

beforeEach(() => {
  api.register('settings', {
    get: vi
      .fn()
      .mockResolvedValue({ schema_version: 1, ui: { theme: 'dark' } }),
    put: vi.fn().mockImplementation(async (s) => s),
  });
});

describe('settings store', () => {
  it('load() pulls from api', async () => {
    const s = createSettingsStore();
    await s.load();
    expect(s.settings().ui.theme).toBe('dark');
  });

  it('save() round-trips', async () => {
    const s = createSettingsStore();
    await s.load();
    await s.save({ schema_version: 1, ui: { theme: 'light' } });
    expect(s.settings().ui.theme).toBe('light');
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

- [ ] **Step 3: Refactor `stores/settings.ts`**

```ts
// src/stores/settings.ts
import { createSignal } from 'solid-js';
import { api } from '../services/api/router';
import type { Settings } from '../services/api/types';

export interface SettingsStore {
  settings: () => Settings;
  loading: () => boolean;
  error: () => Error | null;
  load: () => Promise<void>;
  save: (s: Settings) => Promise<void>;
}

const DEFAULT: Settings = { schema_version: 1, ui: {} };

export function createSettingsStore(): SettingsStore {
  const [settings, setSettings] = createSignal<Settings>(DEFAULT);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<Error | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setSettings(await api.settings().get());
    } catch (e) {
      setError(e as Error);
    } finally {
      setLoading(false);
    }
  };

  const save = async (next: Settings) => {
    const prev = settings();
    setSettings(next);
    try {
      const echoed = await api.settings().put(next);
      setSettings(echoed);
    } catch (e) {
      setSettings(prev);
      throw e;
    }
  };

  return { settings, loading, error, load, save };
}

export const settingsStore = createSettingsStore();
```

- [ ] **Step 4: Run, expect PASS**

- [ ] **Step 5: Commit**

```bash
git add desktop/src/stores/settings.ts desktop/src/stores/__tests__/settings.test.ts
git commit -m "refactor(desktop-store): settings store sources from services/api"
```

---

## Task 32: Wire `CronView.tsx` to `cronStore`

**Files:**
- Modify: `desktop/src/modules/cron/CronView.tsx`

- [ ] **Step 1: Replace the in-component mock array with the store**

Find the existing `const MOCK_JOBS = [...]` (or equivalent) declaration
in `CronView.tsx` and remove it. At the top of the component:

```tsx
import { onMount } from 'solid-js';
import { cronStore } from '../../stores/cron';

// inside the component function:
onMount(() => {
  void cronStore.load();
});

const jobs = cronStore.jobs;
const loading = cronStore.loading;
const error = cronStore.error;
```

Replace every reference to the old mock array with `jobs()`. If the
view contains a "pin" toggle, wire it to:

```tsx
onClick={() => cronStore.togglePinned(job.id).catch(() => {/* error toast handled by store */})}
```

> **Constraint (D10):** Do NOT modify markup, class names, or styles.
> Only the data source changes. Visual diff in Task 38 enforces this.

- [ ] **Step 2: Manual smoke**

```bash
cd desktop
VITE_API_MODE=mock npm run dev
# Navigate to /cron, verify two mocked jobs appear.
```

- [ ] **Step 3: Commit**

```bash
git add desktop/src/modules/cron/CronView.tsx
git commit -m "refactor(desktop-cron): source CronView from cronStore"
```

---

## Task 33: Wire model module to `modelsStore`

**Files:**
- Modify: model module entry (likely `desktop/src/modules/model/ModelView.tsx`
  or wherever `models.ts` is currently imported).

- [ ] **Step 1: Replace direct imports**

Anywhere that previously imported a hard-coded provider list, swap to:

```ts
import { onMount } from 'solid-js';
import { modelsStore } from '../../stores/models';

onMount(() => { void modelsStore.load(); });
const providers = modelsStore.providers;
```

- [ ] **Step 2: Manual smoke**

```bash
VITE_API_MODE=mock npm run dev
# Navigate to /model, verify two mocked providers appear.
```

- [ ] **Step 3: Commit**

```bash
git add desktop/src/modules/model
git commit -m "refactor(desktop-model): source ModelView from modelsStore"
```

---

## Section checkpoint

After Task 33:
- `npm run test` passes (vitest unit suite for `services/api/` + stores).
- `VITE_API_MODE=mock npm run dev` renders Cron + Model pages with
  mocked data.
- `VITE_API_MODE=http npm run tauri:dev` renders the same pages but
  sourced from the live sidecar.
