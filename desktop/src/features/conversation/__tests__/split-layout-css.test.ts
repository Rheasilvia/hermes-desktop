import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const readConversationCss = (file: string) =>
  readFileSync(resolve(process.cwd(), `src/features/conversation/${file}`), 'utf8');

const ruleBody = (css: string, selector: string) =>
  css.match(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{(?<body>[^}]+)\\}`))
    ?.groups?.body ?? '';

describe('conversation split layout CSS', () => {
  it('protects the chat pane with a split-layout minimum width token', () => {
    const css = readConversationCss('ChatView.module.css');
    const chatBodyRule = ruleBody(css, '.chatBody');
    const chatPaneRule = ruleBody(css, '.chatPane');

    expect(chatBodyRule).toContain('--conversation-chat-min-width: 560px');
    expect(chatBodyRule).toContain('--workspace-panel-min-width: 380px');
    expect(chatPaneRule).toContain('min-width: min(100%, var(--conversation-chat-min-width))');
  });

  it('lets the composer wrap and truncate controls inside narrow containers', () => {
    const css = readConversationCss('MessageInput.module.css');
    const wrapperRule = ruleBody(css, '.wrapper');
    const toolbarRule = ruleBody(css, '.toolbar');
    const toolbarRightRule = ruleBody(css, '.toolbarRight');
    const statusRowRule = ruleBody(css, '.composerStatusRow');
    const permissionLabelRule = ruleBody(css, '.permissionButtonLabel');
    const compactPermissionRule = ruleBody(css, '.actionBtn.permissionButtonCompact');
    const compactStatusContextRule = ruleBody(css, '.wrapperCompact .statusContextGroup');

    expect(wrapperRule).toContain('container-type: inline-size');
    expect(css).toContain('@container (max-width: 560px)');
    expect(toolbarRule).toContain('flex-wrap: wrap');
    expect(toolbarRightRule).toContain('flex-wrap: wrap');
    expect(statusRowRule).toContain('flex-wrap: wrap');
    expect(permissionLabelRule).toContain('text-overflow: ellipsis');
    expect(css).toContain('.wrapperCompact .toolbar');
    expect(css).toContain('.wrapperCompact .stopButton span');
    expect(compactPermissionRule).toContain('width: 28px');
    expect(compactPermissionRule).toContain('min-width: 28px');
    expect(compactPermissionRule).toContain('height: 28px');
    expect(compactStatusContextRule).toContain('justify-content: flex-end');
    expect(compactStatusContextRule).toContain('margin-left: auto');
    expect(compactStatusContextRule).toContain('flex-wrap: nowrap');
    expect(compactStatusContextRule).not.toContain('display: grid');
  });

  it('uses fixed icon-first controls for the compact model selector', () => {
    const css = readConversationCss('ModelSelector.module.css');
    const compactModelRule = ruleBody(css, '.modelSegmentCompact');
    const compactEffortRule = ruleBody(css, '.effortSegmentCompact');

    expect(css).toContain('.triggerCompact');
    expect(compactModelRule).toContain('width: 28px');
    expect(compactModelRule).toContain('min-width: 28px');
    expect(compactModelRule).toContain('height: 28px');
    expect(compactEffortRule).toContain('min-width: 28px');
    expect(compactEffortRule).toContain('height: 28px');
  });

  it('allows workspace and branch pills to shrink inside the right-aligned status group', () => {
    const workspaceCss = readConversationCss('WorkspacePicker.module.css');
    const gitCss = readConversationCss('GitBranchPicker.module.css');

    for (const css of [workspaceCss, gitCss]) {
      const pillRule = ruleBody(css, '.pill');
      expect(pillRule).toContain('flex: 0 1 auto');
      expect(pillRule).toContain('min-width: 0');
      expect(pillRule).toContain('max-width: 100%');
    }
  });

  it('keeps workspace panel tabs flexible and provides a container overlay mode', () => {
    const css = readConversationCss('WorkspaceSidePanel.module.css');
    const panelRule = ruleBody(css, '.panel');
    const tabsRule = ruleBody(css, '.tabs');
    const tabRule = ruleBody(css, '.tab');
    const overlayRule = ruleBody(css, '.panelOverlay');

    expect(panelRule).toContain('min-width: var(--workspace-panel-min-width, 380px)');
    expect(panelRule).toContain('container-type: inline-size');
    expect(tabsRule).toContain('min-width: 0');
    expect(tabRule).toContain('flex: 1 1 0');
    expect(tabRule).toContain('min-width: 0');
    expect(overlayRule).toContain('position: absolute');
    expect(css).toContain('@container (max-width: 360px)');
  });
});
