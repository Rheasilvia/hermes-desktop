import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const readSidebarCss = () =>
  readFileSync(resolve(process.cwd(), 'src/shell/Sidebar.module.css'), 'utf8');

const ruleBody = (css: string, selector: string) =>
  css.match(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{(?<body>[^}]+)\\}`))
    ?.groups?.body ?? '';

describe('Sidebar context menu CSS', () => {
  it('renders the right-click menu as a solid tokenized floating surface', () => {
    const css = readSidebarCss();
    const menuRule = ruleBody(css, '.contextDropdown');
    const itemRule = ruleBody(css, '.dropdownItem');
    const hoverRule = ruleBody(css, '.dropdownItem:hover');
    const focusRule = ruleBody(css, '.dropdownItem:focus-visible');
    const dangerRule = ruleBody(css, '.dropdownDanger:hover');
    const dangerFocusRule = ruleBody(css, '.dropdownDanger:focus-visible');
    const menuSurfaceRules = [
      menuRule,
      itemRule,
      hoverRule,
      focusRule,
      dangerRule,
      dangerFocusRule,
    ].join('\n');

    expect(menuRule).toContain('background: var(--color-surface)');
    expect(menuRule).toContain('border: 1px solid var(--color-border)');
    expect(menuRule).toContain('box-shadow: var(--shadow-lg)');
    expect(menuRule).toContain('z-index: var(--z-modal)');
    expect(menuRule).not.toContain('var(--color-cream)');
    expect(menuRule).not.toContain('backdrop-filter');
    expect(menuRule).not.toContain('gap:');
    expect(menuRule).not.toContain('color-mix');

    expect(itemRule).toContain('background: var(--color-surface)');
    expect(itemRule).toContain('border: 0');
    expect(itemRule).toContain('color: var(--color-on-surface)');
    expect(itemRule).not.toContain('var(--color-charcoal-warm)');
    expect(hoverRule).toContain('background: color-mix(in srgb, var(--color-primary)');
    expect(hoverRule).toContain('var(--color-surface)');
    expect(focusRule).toContain('background: color-mix(in srgb, var(--color-primary)');
    expect(focusRule).toContain('var(--color-surface)');
    expect(focusRule).toContain('box-shadow: inset 0 0 0 1px var(--color-border-focus)');
    expect(dangerRule).toContain('background: color-mix(in srgb, var(--color-error)');
    expect(dangerRule).toContain('var(--color-surface)');
    expect(dangerFocusRule).toContain('background: color-mix(in srgb, var(--color-error)');
    expect(dangerFocusRule).toContain('var(--color-surface)');

    expect(menuSurfaceRules).not.toContain('background: transparent');
    expect(menuSurfaceRules).not.toContain('var(--color-hover-overlay)');
    expect(menuSurfaceRules).not.toContain('var(--color-active-overlay)');
    expect(menuSurfaceRules).not.toContain('var(--color-error-surface)');
    expect(menuSurfaceRules).not.toContain('rgba(');
    expect(menuSurfaceRules).not.toContain('transparent');
    expect(menuSurfaceRules).not.toContain('border: 1px solid var(--sidebar-context-menu-item-border)');
  });
});
