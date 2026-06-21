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
    const messageListRule = ruleBody(css, '.messageList');
    const messageListWithEnvironmentRule = ruleBody(css, '.messageListWithEnvironment');
    const messageColumnRule = ruleBody(css, '.messageColumn');
    const inputAreaRule = ruleBody(css, '.inputArea');
    const inputAreaWithEnvironmentRule = ruleBody(css, '.inputAreaWithEnvironment');
    const inputColumnRule = ruleBody(css, '.inputColumn');
    const environmentPopoverRule = ruleBody(css, '.environmentPopover');

    expect(chatBodyRule).toContain('--conversation-chat-min-width: 560px');
    expect(chatBodyRule).toContain('--conversation-chat-max-width: 880px');
    expect(chatBodyRule).toContain('--conversation-chat-gutter: clamp(16px, 5vw, 48px)');
    expect(chatBodyRule).toContain('--environment-popover-width: 344px');
    expect(chatBodyRule).toContain('--environment-popover-reserved-width: calc(var(--environment-popover-width) + var(--space-10))');
    expect(chatPaneRule).toContain('min-width: min(100%, var(--conversation-chat-min-width))');
    expect(messageListRule).toContain('padding: var(--space-4) var(--conversation-chat-gutter) 52px');
    expect(messageListRule).toContain('scrollbar-gutter: stable');
    expect(messageListWithEnvironmentRule).toContain('padding-right: calc(var(--conversation-chat-gutter) + var(--environment-popover-reserved-width))');
    expect(messageColumnRule).toContain('width: min(100%, var(--conversation-chat-max-width))');
    expect(messageColumnRule).toContain('margin-inline: auto');
    expect(inputAreaRule).toContain('padding: 8px var(--conversation-chat-gutter) 24px');
    expect(inputAreaWithEnvironmentRule).toContain('padding-right: calc(var(--conversation-chat-gutter) + var(--environment-popover-reserved-width))');
    expect(inputColumnRule).toContain('width: min(100%, var(--conversation-chat-max-width))');
    expect(inputColumnRule).toContain('margin-inline: auto');
    expect(inputColumnRule).toContain('position: relative');
    expect(environmentPopoverRule).toContain('position: absolute');
    expect(environmentPopoverRule).toContain('right: var(--environment-popover-inline-gap)');
    expect(environmentPopoverRule).toContain('z-index: var(--z-overlay)');
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
    expect(wrapperRule).toContain('padding: 0');
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

  it('keeps composer-adjacent docks aligned to the centered chat column', () => {
    const promptDockCss = readConversationCss('turn/PromptDock.module.css');
    const recoveryCss = readConversationCss('ConversationRecoveryBanner.module.css');
    const promptDockRule = ruleBody(promptDockCss, '.dock');
    const recoveryBannerRule = ruleBody(recoveryCss, '.banner');

    expect(promptDockRule).toContain('padding: 4px 0');
    expect(promptDockRule).not.toContain('padding: 4px 32px');
    expect(recoveryBannerRule).toContain('margin: 0 0 var(--space-2)');
    expect(recoveryBannerRule).not.toContain('margin: 0 var(--space-6) var(--space-2)');
  });

  it('lets assistant responses fill the same centered column as the composer', () => {
    const css = readConversationCss('AssistantMessage.module.css');
    const contentRule = ruleBody(css, '.content');

    expect(contentRule).toContain('width: 100%');
    expect(contentRule).toContain('max-width: 100%');
    expect(contentRule).toContain('min-width: 0');
    expect(contentRule).not.toContain('max-width: 85%');
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
    const bodyFrozenRule = ruleBody(css, '.bodyFrozen');
    const emptyStateRule = ruleBody(css, '.emptyState');
    const overlayRule = ruleBody(css, '.panelOverlay');

    expect(panelRule).toContain('width: 100%');
    expect(panelRule).toContain('min-width: var(--tools-dock-min-width, 380px)');
    expect(panelRule).not.toContain('container-type: inline-size');
    expect(panelRule).not.toContain('border-left');
    expect(bodyRule).toContain('min-height: 0');
    expect(bodyRule).toContain('width: 100%');
    expect(bodyRule).toContain('overflow: hidden');
    expect(bodyRule).toContain('container-type: inline-size');
    expect(bodyFrozenRule).toContain('align-self: flex-end');
    expect(bodyFrozenRule).toContain('contain: layout style paint');
    expect(emptyStateRule).toContain('justify-content: center');
    expect(overlayRule).toContain('position: absolute');
    expect(css).toContain('@container (max-width: 360px)');
    expect(css).not.toContain('@media (max-width: 980px)');
    expect(css).not.toContain('floatingCloseButton');
    expect(css).not.toContain('pageHeader');
    expect(css).not.toContain('tabBar');
    expect(css).not.toContain('toolMenu');
  });

  it('anchors the right tools pane as a split-grid sibling with a top-to-bottom divider', () => {
    const css = readShellCss('AppLayout.module.css');
    const titleBarCss = readShellCss('TitleBar.module.css');
    const sidebarCss = readShellCss('Sidebar.module.css');
    const layoutRule = ruleBody(css, '.layout');
    const sidebarDockRule = ruleBody(css, '.sidebarDock');
    const workspaceFrameRule = ruleBody(css, '.workspaceFrame');
    const workspaceSplitGridRule = ruleBody(css, '.workspaceSplitGrid');
    const mainTitlebarCellRule = ruleBody(css, '.mainTitlebarCell');
    const mainFrameRule = ruleBody(css, '.mainFrame');
    const mainColumnFrozenRule = ruleBody(css, '.mainColumnFrozen');
    const contentRule = ruleBody(css, '.content');
    const leftSeparatorRule = ruleBody(css, '.leftSidebarSeparator');
    const leftHandleRule = ruleBody(css, '.leftDragHandle');
    const rightPaneRule = ruleBody(css, '.rightToolsPane');
    const overlayPaneRule = ruleBody(css, '.rightToolsPaneOverlay');
    const rightToolsContentRule = ruleBody(css, '.rightToolsContent');
    const separatorRule = ruleBody(css, '.rightDiffSeparator');
    const handleRule = ruleBody(css, '.rightDragHandle');
    const sidebarRule = ruleBody(sidebarCss, '.sidebar');
    const rightGroupRule = ruleBody(titleBarCss, '.rightGroup');
    const toolDockToolbarRule = ruleBody(titleBarCss, '.toolDockToolbar');
    const toolTabsRule = ruleBody(titleBarCss, '.toolTabs');
    const toolTabListRule = ruleBody(titleBarCss, '.toolTabList');
    const toolTabActiveRule = ruleBody(titleBarCss, '.toolTabActive');
    const toolMenuRule = ruleBody(titleBarCss, '.toolMenu');

    expect(layoutRule).toContain('--tools-dock-min-width: 380px');
    expect(layoutRule).not.toContain('--environment-popover-width');
    expect(css).not.toContain('contentWithEnvironment');
    expect(css).not.toContain('environmentPopover');
    expect(layoutRule).toContain('flex-direction: row');
    expect(layoutRule).toContain('position: relative');
    expect(sidebarDockRule).toContain('height: 100%');
    expect(workspaceFrameRule).toContain('flex: 1 1 0');
    expect(workspaceFrameRule).toContain('position: relative');
    expect(workspaceFrameRule).not.toContain('flex-direction: column');
    expect(workspaceSplitGridRule).toContain('display: grid');
    expect(workspaceSplitGridRule).toContain('grid-template-rows: var(--titlebar-height) minmax(0, 1fr)');
    expect(workspaceSplitGridRule).toContain('grid-template-columns: minmax(0, 1fr)');
    expect(mainTitlebarCellRule).toContain('grid-row: 1');
    expect(mainTitlebarCellRule).toContain('grid-column: 1');
    expect(mainFrameRule).toContain('grid-row: 2');
    expect(mainFrameRule).toContain('grid-column: 1');
    expect(mainFrameRule).toContain('flex: 1');
    expect(mainFrameRule).not.toContain('padding-right');
    expect(mainFrameRule).not.toContain('transition: margin-right');
    expect(mainColumnFrozenRule).toContain('contain: layout style paint');
    expect(contentRule).toContain('overflow: auto');
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
    expect(rightPaneRule).toContain('grid-row: 1 / 3');
    expect(rightPaneRule).toContain('grid-column: 2');
    expect(rightPaneRule).toContain('display: flex');
    expect(rightPaneRule).toContain('flex-direction: column');
    expect(rightPaneRule).toContain('z-index: var(--z-sticky)');
    expect(overlayPaneRule).toContain('position: absolute');
    expect(overlayPaneRule).toContain('top: 0');
    expect(overlayPaneRule).toContain('right: 0');
    expect(overlayPaneRule).toContain('bottom: 0');
    expect(rightToolsContentRule).toContain('flex: 1');
    expect(rightToolsContentRule).toContain('min-height: 0');
    expect(separatorRule).toContain('position: absolute');
    expect(separatorRule).toContain('top: 0');
    expect(separatorRule).toContain('bottom: 0');
    expect(separatorRule).toContain('width: 1px');
    expect(separatorRule).toContain('z-index: var(--z-sticky)');
    expect(separatorRule).toContain('background: var(--color-shell-separator)');
    expect(handleRule).toContain('position: absolute');
    expect(handleRule).toContain('top: 0');
    expect(handleRule).toContain('bottom: 0');
    expect(handleRule).toContain('width: 8px');
    expect(handleRule).toContain('z-index: var(--z-sticky)');
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
    expect(toolDockToolbarRule).toContain('height: var(--titlebar-height)');
    expect(toolDockToolbarRule).toContain('border-bottom: 1px solid var(--color-border-light)');
    expect(toolDockToolbarRule).toContain('width: 100%');
    expect(toolTabsRule).toContain('align-items: center');
    expect(toolTabsRule).toContain('flex: 1 1 auto');
    expect(toolTabListRule).toContain('overflow-x: auto');
    expect(toolTabActiveRule).toContain('background: color-mix(in srgb, var(--color-on-surface) 5%, var(--color-surface))');
    expect(toolMenuRule).toContain('z-index: var(--z-dropdown)');
    expect(toolMenuRule).not.toContain('var(--z-overlay)');
  });

  it('virtualizes heavy diff content for live Review resizing', () => {
    const css = readConversationCss('../diff/DiffPanel.module.css');
    const diffContent = readFileSync(resolve(process.cwd(), 'src/features/diff/DiffContent.tsx'), 'utf8');
    const diffPanel = readFileSync(resolve(process.cwd(), 'src/features/diff/DiffPanel.tsx'), 'utf8');
    const fileNavigator = readFileSync(resolve(process.cwd(), 'src/features/diff/DiffFileNavigator.tsx'), 'utf8');
    const virtualDiff = readFileSync(resolve(process.cwd(), 'src/features/diff/virtual-diff.ts'), 'utf8');
    const panelRule = ruleBody(css, '.diffPanel');
    const headerRule = ruleBody(css, '.diffPanelHeader');
    const titleRule = ruleBody(css, '.diffPanelTitle');
    const reviewBodyRule = ruleBody(css, '.diffReviewBody');
    const fileRailRule = ruleBody(css, '.diffFileRail');
    const fileListRule = ruleBody(css, '.diffFileList');
    const fileRowRule = ruleBody(css, '.diffFileRow');
    const drawerRule = ruleBody(css, '.diffFileDrawer');
    const headerFilesButtonRule = ruleBody(css, '.diffHeaderFilesButton');
    const contentRule = ruleBody(css, '.diffContent');
    const viewportRule = ruleBody(css, '.diffVirtualViewport');
    const surfaceRule = ruleBody(css, '.diffVirtualSurface');
    const virtualRowRule = ruleBody(css, '.diffVirtualRow');
    const lineRule = ruleBody(css, '.diffLine');
    const lineContentRule = ruleBody(css, '.diffLineContent');

    expect(panelRule).toContain('contain: layout style');
    expect(panelRule).toContain('container-type: inline-size');
    expect(headerRule).toContain('align-items: center');
    expect(headerRule).toContain('gap: var(--space-2)');
    expect(headerRule).toContain('overflow: hidden');
    expect(titleRule).toContain('flex: 0 0 auto');
    expect(reviewBodyRule).toContain('display: grid');
    expect(reviewBodyRule).toContain('grid-template-columns: minmax(0, 1fr)');
    expect(fileRailRule).toContain('display: none');
    expect(fileRailRule).toContain('border-right: 1px solid var(--color-border-light)');
    expect(fileListRule).toContain('overflow: auto');
    expect(fileListRule).toContain('contain: layout style paint');
    expect(fileRowRule).toContain('position: absolute');
    expect(fileRowRule).toContain('display: grid');
    expect(fileRowRule).toContain('grid-template-columns: 8px minmax(0, 1fr) auto');
    expect(drawerRule).toContain('position: absolute');
    expect(drawerRule).toContain('width: min(320px, 88%)');
    expect(headerFilesButtonRule).toContain('height: 26px');
    expect(css).toContain('@container (min-width: 720px)');
    expect(css).toContain('grid-template-columns: 224px minmax(0, 1fr)');
    expect(css).toContain('.diffHeaderFilesButton');
    expect(css).toContain('.diffFileDrawerBackdrop');
    expect(contentRule).toContain('overflow: hidden');
    expect(viewportRule).toContain('overflow: auto');
    expect(viewportRule).toContain('contain: layout style paint');
    expect(surfaceRule).toContain('position: relative');
    expect(surfaceRule).toContain('contain: layout style paint');
    expect(virtualRowRule).toContain('position: absolute');
    expect(virtualRowRule).toContain('will-change: transform');
    expect(lineRule).toContain('display: grid');
    expect(lineRule).toContain('grid-template-columns: 48px 48px 16px minmax(0, 1fr)');
    expect(lineRule).not.toContain('display: flex');
    expect(lineContentRule).toContain('white-space: pre');
    expect(lineContentRule).toContain('min-width: 0');
    expect(css).toContain(":global([data-right-tools-dragging='true']) .diffLine");
    expect(diffPanel).toContain('DiffFileNavigator');
    expect(diffPanel).not.toContain('FileTabs');
    expect(fileNavigator).toContain('role="listbox"');
    expect(fileNavigator).toContain('role="option"');
    expect(fileNavigator).toContain('filterDiffFileRows');
    expect(fileNavigator).toContain('virtualizeFixedRows');
    expect(diffContent).toContain('virtualizeDiffRows');
    expect(diffContent).toContain('data-testid="diff-virtual-line"');
    expect(diffContent).not.toContain('<DiffHunk');
    expect(virtualDiff).toContain('export function flattenDiffFile');
    expect(virtualDiff).toContain('export function virtualizeDiffRows');
    expect(virtualDiff).toContain('export function virtualizeFixedRows');
  });
});
