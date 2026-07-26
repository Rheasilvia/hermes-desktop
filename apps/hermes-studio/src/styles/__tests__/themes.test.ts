import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const STYLES_DIR = resolve(__dirname, '..');
const APP_ROOT = resolve(STYLES_DIR, '..', '..');
const LOCAL_FONT_DIR = resolve(APP_ROOT, 'src', 'assets', 'fonts');
const LOCAL_MONO_FONTS = [
  'JetBrainsMono-Regular.woff2',
  'JetBrainsMono-Bold.woff2',
  'JetBrainsMono-Italic.woff2',
];

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
  it('packages local mono fonts without remote font connections', () => {
    const html = readFileSync(resolve(APP_ROOT, 'index.html'), 'utf8');
    const root = readStyle('tokens.css');

    expect(html).not.toMatch(/fonts\.(?:googleapis|gstatic)\.com/i);
    expect(html).not.toMatch(/rel=["']preconnect["']/i);
    for (const font of LOCAL_MONO_FONTS) {
      expect(statSync(resolve(LOCAL_FONT_DIR, font)).size).toBeGreaterThan(0);
      expect(root).toContain(`../assets/fonts/${font}`);
    }
    expect(root).toContain("font-family: 'JetBrains Mono Local'");
    expect(root).toContain("--font-mono: 'JetBrains Mono Local'");
    expect(root).toContain('--font-serif: ui-serif');
    expect(root).toContain('system-ui');
  });

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

  it('dark theme darkens callout + date-separator surfaces', () => {
    const dark = readStyle('themes/dark.css');
    expect(dark).toContain('--color-callout-bg');
    expect(dark).toContain('--color-callout-border');
    expect(dark).toContain('--color-date-separator');
  });
});
