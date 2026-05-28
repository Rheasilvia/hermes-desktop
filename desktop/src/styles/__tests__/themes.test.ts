import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const STYLES_DIR = resolve(__dirname, '..');

function readStyle(file: string): string {
  return readFileSync(resolve(STYLES_DIR, file), 'utf8');
}

const CANONICAL_TOKENS = [
  '--color-hover-overlay',
  '--color-active-overlay',
  '--color-primary-soft',
  '--color-primary-light',
  '--color-primary-strong',
  '--color-success-surface',
  '--color-warning-surface',
  '--color-error-surface',
  '--color-info-surface',
];

describe('theme tokens', () => {
  it(':root defines the full canonical token set', () => {
    const root = readStyle('tokens.css');
    for (const token of CANONICAL_TOKENS) {
      expect(root).toContain(token);
    }
  });

  it('dark theme overrides every canonical token', () => {
    const dark = readStyle('themes/dark.css');
    expect(dark).toMatch(/\[data-theme="dark"\]/);
    for (const token of CANONICAL_TOKENS) {
      expect(dark, `dark.css missing override for ${token}`).toContain(token);
    }
  });

  it('earth theme overrides core overlay + primary tokens', () => {
    const earth = readStyle('themes/earth.css');
    expect(earth).toMatch(/\[data-theme="earth"\]/);
    for (const token of [
      '--color-hover-overlay',
      '--color-active-overlay',
      '--color-primary-soft',
      '--color-primary-strong',
    ]) {
      expect(earth, `earth.css missing override for ${token}`).toContain(token);
    }
  });

  it('dark theme darkens callout + date-separator surfaces', () => {
    const dark = readStyle('themes/dark.css');
    expect(dark).toContain('--color-callout-bg');
    expect(dark).toContain('--color-callout-border');
    expect(dark).toContain('--color-date-separator');
  });
});
