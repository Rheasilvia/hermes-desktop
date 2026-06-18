import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const readConversationCss = (file: string) =>
  readFileSync(resolve(process.cwd(), `src/features/conversation/${file}`), 'utf8');

const readShellCss = (file: string) =>
  readFileSync(resolve(process.cwd(), `src/shell/${file}`), 'utf8');

const ruleBody = (css: string, selector: string) =>
  css.match(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{(?<body>[^}]+)\\}`))
    ?.groups?.body ?? '';

describe('conversation split layout CSS', () => {
  it('protects the chat pane with a split-layout minimum width token', () => {
    const css = readConversationCss('ChatView.module.css');
    const chatBodyRule = ruleBody(css, '.chatBody');
    const chatPaneRule = ruleBody(css, '.chatPane');

    expect(chatBodyRule).toContain('--conversation-chat-min-width: 560px');
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

    expect(wrapperRule).not.toContain('container-type');
    expect(css).not.toContain('@container (max-width: 560px)');
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

  it('keeps the right tools dock responsive and provides a container overlay mode', () => {
    const css = readConversationCss('RightToolPanel.module.css');
    const panelRule = ruleBody(css, '.panel');
    const bodyRule = ruleBody(css, '.body');
    const emptyStateRule = ruleBody(css, '.emptyState');
    const overlayRule = ruleBody(css, '.panelOverlay');

    expect(panelRule).toContain('width: 100%');
    expect(panelRule).toContain('min-width: var(--tools-dock-min-width, 380px)');
    expect(panelRule).toContain('container-type: inline-size');
    expect(panelRule).not.toContain('border-left');
    expect(bodyRule).toContain('min-height: 0');
    expect(bodyRule).toContain('overflow: hidden');
    expect(emptyStateRule).toContain('justify-content: center');
    expect(overlayRule).toContain('position: absolute');
    expect(css).toContain('@container (max-width: 360px)');
    expect(css).not.toContain('@media (max-width: 980px)');
    expect(css).not.toContain('floatingCloseButton');
    expect(css).not.toContain('pageHeader');
    expect(css).not.toContain('tabBar');
    expect(css).not.toContain('toolMenu');
  });

  it('anchors the right tools split at the window top from the shell layout', () => {
    const css = readShellCss('AppLayout.module.css');
    const titleBarCss = readShellCss('TitleBar.module.css');
    const sidebarCss = readShellCss('Sidebar.module.css');
    const layoutRule = ruleBody(css, '.layout');
    const sidebarDockRule = ruleBody(css, '.sidebarDock');
    const workspaceFrameRule = ruleBody(css, '.workspaceFrame');
    const mainFrameRule = ruleBody(css, '.mainFrame');
    const draggingMainFrameRule = ruleBody(css, '.layoutDragging .mainFrame');
    const resizingMainFrameRule = ruleBody(css, '.layoutResizing .mainFrame');
    const leftSeparatorRule = ruleBody(css, '.leftSidebarSeparator');
    const leftHandleRule = ruleBody(css, '.leftDragHandle');
    const dockRule = ruleBody(css, '.rightToolsDock');
    const overlayDockRule = ruleBody(css, '.rightToolsDockOverlay');
    const separatorRule = ruleBody(css, '.rightDiffSeparator');
    const handleRule = ruleBody(css, '.rightDragHandle');
    const sidebarRule = ruleBody(sidebarCss, '.sidebar');
    const rightGroupRule = ruleBody(titleBarCss, '.rightGroup');
    const toolTabsRule = ruleBody(titleBarCss, '.toolTabs');
    const toolTabListRule = ruleBody(titleBarCss, '.toolTabList');
    const toolTabActiveRule = ruleBody(titleBarCss, '.toolTabActive');
    const toolMenuRule = ruleBody(titleBarCss, '.toolMenu');

    expect(layoutRule).toContain('--tools-dock-min-width: 380px');
    expect(layoutRule).toContain('flex-direction: row');
    expect(layoutRule).toContain('position: relative');
    expect(sidebarDockRule).toContain('height: 100%');
    expect(workspaceFrameRule).toContain('flex-direction: column');
    expect(workspaceFrameRule).toContain('flex: 1');
    expect(mainFrameRule).toContain('flex: 1');
    expect(mainFrameRule).toContain('transition: margin-right');
    expect(draggingMainFrameRule).toContain('transition: none');
    expect(resizingMainFrameRule).toContain('transition: none');
    expect(leftSeparatorRule).toContain('position: absolute');
    expect(leftSeparatorRule).toContain('top: 0');
    expect(leftSeparatorRule).toContain('bottom: 0');
    expect(leftSeparatorRule).toContain('width: 1px');
    expect(leftSeparatorRule).toContain('background: var(--color-shell-separator)');
    expect(leftHandleRule).toContain('position: absolute');
    expect(leftHandleRule).toContain('top: 0');
    expect(leftHandleRule).toContain('bottom: 0');
    expect(leftHandleRule).toContain('width: 8px');
    expect(leftHandleRule).toContain('background: transparent');
    expect(leftHandleRule).not.toContain('var(--color-warm-gray)');
    expect(dockRule).toContain('position: absolute');
    expect(dockRule).toContain('top: var(--titlebar-height)');
    expect(dockRule).toContain('right: 0');
    expect(dockRule).toContain('bottom: 0');
    expect(overlayDockRule).toContain('left: 0');
    expect(separatorRule).toContain('position: absolute');
    expect(separatorRule).toContain('top: 0');
    expect(separatorRule).toContain('bottom: 0');
    expect(separatorRule).toContain('width: 1px');
    expect(separatorRule).toContain('background: var(--color-shell-separator)');
    expect(handleRule).toContain('position: absolute');
    expect(handleRule).toContain('top: 0');
    expect(handleRule).toContain('bottom: 0');
    expect(handleRule).toContain('width: 8px');
    expect(handleRule).toContain('background: transparent');
    expect(handleRule).not.toContain('var(--color-warm-gray)');
    expect(sidebarRule).not.toContain('border-right');
    expect(sidebarRule).toContain('width: 100%');
    expect(sidebarRule).toContain('padding-top: var(--titlebar-height)');
    expect(sidebarCss).not.toContain('resizeHandle');
    expect(titleBarCss).toContain('.toolsDockToggleActive');
    expect(titleBarCss).not.toContain('.workspaceToggleActive');
    expect(rightGroupRule).toContain('align-items: center');
    expect(rightGroupRule).toContain('box-sizing: border-box');
    expect(toolTabsRule).toContain('align-items: center');
    expect(toolTabsRule).toContain('flex: 1 1 auto');
    expect(toolTabListRule).toContain('overflow-x: auto');
    expect(toolTabActiveRule).toContain('background: color-mix(in srgb, var(--color-on-surface) 5%, var(--color-surface))');
    expect(toolMenuRule).toContain('z-index: var(--z-dropdown)');
  });
});
