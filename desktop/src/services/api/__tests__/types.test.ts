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
