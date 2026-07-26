import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const readCss = (name: string) =>
  readFileSync(resolve(process.cwd(), `src/shell/${name}`), 'utf8');

const ruleBody = (css: string, selector: string) =>
  css.match(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{(?<body>[^}]+)\\}`))
    ?.groups?.body ?? '';

describe('Electron frameless window drag regions', () => {
  it('uses CSS drag regions for title bars and CSS no-drag for their controls', () => {
    const css = readCss('TitleBar.module.css');

    expect(ruleBody(css, '.titleBar')).toContain('-webkit-app-region: drag');
    expect(ruleBody(css, '.toolDockToolbar')).toContain('-webkit-app-region: drag');
    expect(ruleBody(css, '.actionButton,\n.controlBtn,\n.toolTabItem,\n.toolTab,\n.toolTabRenameInput,\n.toolTabClose,\n.addToolButton,\n.toolMenu,\n.toolMenuItem'))
      .toContain('-webkit-app-region: no-drag');
    expect(ruleBody(css, '.sessionTitle')).not.toContain('-webkit-app-region: no-drag');
  });

  it('keeps the sidebar top strip draggable and every sidebar control no-drag', () => {
    const css = readCss('Sidebar.module.css');

    expect(ruleBody(css, '.dragStrip')).toContain('-webkit-app-region: drag');
    expect(ruleBody(css, '.sidebar button,\n.sidebar input,\n.sidebar a'))
      .toContain('-webkit-app-region: no-drag');
  });
});
