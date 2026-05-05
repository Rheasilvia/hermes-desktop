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
