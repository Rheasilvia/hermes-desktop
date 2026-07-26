// @vitest-environment node
/**
 * Integration tests for config.* methods against a real Python gateway via UDS.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnGateway, type GatewayFixture } from './helpers.js';

describe.skip('config methods — real gateway', () => {
  let gw: GatewayFixture;

  beforeAll(async () => {
    gw = await spawnGateway();
  }, 30_000);

  afterAll(async () => {
    await gw.cleanup();
  }, 10_000);

  describe('config.get', () => {
    it('returns provider info for key "provider"', async () => {
      const result = await gw.sendRequest('config.get', { key: 'provider' });
      expect(result).toBeTypeOf('object');
      expect(result).toHaveProperty('model');
      expect(result).toHaveProperty('provider');
      expect(result).toHaveProperty('providers');
      expect(Array.isArray((result as Record<string, unknown>).providers)).toBe(true);
    });

    it('returns profile info for key "profile"', async () => {
      const result = await gw.sendRequest('config.get', { key: 'profile' });
      expect(result).toBeTypeOf('object');
      expect(result).toHaveProperty('home');
      expect(result).toHaveProperty('display');
      expect((result as Record<string, unknown>).home).toBe(gw.homePath);
    });

    it('returns full config for key "full"', async () => {
      const result = await gw.sendRequest('config.get', { key: 'full' });
      expect(result).toBeTypeOf('object');
      expect(result).toHaveProperty('config');
      const cfg = (result as Record<string, unknown>).config as Record<string, unknown>;
      expect(cfg).toHaveProperty('model');
      expect(cfg).toHaveProperty('display');
    });

    it('returns prompt for key "prompt"', async () => {
      const result = await gw.sendRequest('config.get', { key: 'prompt' });
      expect(result).toBeTypeOf('object');
      expect(result).toHaveProperty('prompt');
    });

    it('returns skin for key "skin"', async () => {
      const result = await gw.sendRequest('config.get', { key: 'skin' });
      expect(result).toBeTypeOf('object');
      expect(result).toHaveProperty('value');
      expect((result as Record<string, unknown>).value).toBeTypeOf('string');
    });

    it('returns personality for key "personality"', async () => {
      const result = await gw.sendRequest('config.get', { key: 'personality' });
      expect(result).toBeTypeOf('object');
      expect(result).toHaveProperty('value');
      expect((result as Record<string, unknown>).value).toBeTypeOf('string');
    });

    it('returns reasoning for key "reasoning"', async () => {
      const result = await gw.sendRequest('config.get', { key: 'reasoning' });
      expect(result).toBeTypeOf('object');
      expect(result).toHaveProperty('value');
      expect(result).toHaveProperty('display');
      expect(['low', 'medium', 'high']).toContain((result as Record<string, unknown>).value);
      expect(['show', 'hide']).toContain((result as Record<string, unknown>).display);
    });

    it('returns details_mode for key "details_mode"', async () => {
      const result = await gw.sendRequest('config.get', { key: 'details_mode' });
      expect(result).toBeTypeOf('object');
      expect(result).toHaveProperty('value');
      expect(['hidden', 'collapsed', 'expanded']).toContain((result as Record<string, unknown>).value);
    });

    it('returns thinking_mode for key "thinking_mode"', async () => {
      const result = await gw.sendRequest('config.get', { key: 'thinking_mode' });
      expect(result).toBeTypeOf('object');
      expect(result).toHaveProperty('value');
      expect(['collapsed', 'truncated', 'full']).toContain((result as Record<string, unknown>).value);
    });

    it('returns compact for key "compact"', async () => {
      const result = await gw.sendRequest('config.get', { key: 'compact' });
      expect(result).toBeTypeOf('object');
      expect(result).toHaveProperty('value');
      expect(['on', 'off']).toContain((result as Record<string, unknown>).value);
    });

    it('returns statusbar for key "statusbar"', async () => {
      const result = await gw.sendRequest('config.get', { key: 'statusbar' });
      expect(result).toBeTypeOf('object');
      expect(result).toHaveProperty('value');
      expect((result as Record<string, unknown>).value).toBeTypeOf('string');
    });

    it('returns mtime for key "mtime"', async () => {
      const result = await gw.sendRequest('config.get', { key: 'mtime' });
      expect(result).toBeTypeOf('object');
      expect(result).toHaveProperty('mtime');
      expect((result as Record<string, unknown>).mtime).toBeTypeOf('number');
    });

    it('returns error for unknown key', async () => {
      await expect(gw.sendRequest('config.get', { key: 'unknown_key_xyz' })).rejects.toThrow();
    });
  });

  describe('config.show', () => {
    it('returns structured sections', async () => {
      const result = await gw.sendRequest('config.show');
      expect(result).toBeTypeOf('object');
      expect(result).toHaveProperty('sections');

      const sections = (result as Record<string, unknown>).sections as Array<Record<string, unknown>>;
      expect(Array.isArray(sections)).toBe(true);
      expect(sections.length).toBeGreaterThanOrEqual(3);

      const titles = sections.map((s) => s.title);
      expect(titles).toContain('Model');
      expect(titles).toContain('Agent');
      expect(titles).toContain('Environment');

      for (const section of sections) {
        expect(section).toHaveProperty('rows');
        expect(Array.isArray(section.rows)).toBe(true);
        for (const row of section.rows as unknown[][]) {
          expect(Array.isArray(row)).toBe(true);
          expect(row.length).toBe(2);
        }
      }
    });
  });
});
