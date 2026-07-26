import { render, fireEvent, screen, waitFor } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const { navigateMock, locationState } = vi.hoisted(() => ({
  navigateMock: vi.fn(),
  locationState: { pathname: '/conversation/test-session' },
}));

const { sidePanelState } = vi.hoisted(() => ({
  sidePanelState: {
    open: false,
    activeView: 'menu',
    openTabs: [] as Array<{ id: string; kind: string; title: string; cwd: string | null }>,
    panelWidth: 500,
    setPanelWidth: vi.fn((width: number) => {
      sidePanelState.panelWidth = width;
    }),
  },
}));

vi.mock('@solidjs/router', () => ({
  useNavigate: () => navigateMock,
  useLocation: () => locationState,
}));

vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => false,
  invoke: vi.fn(),
}));

vi.mock('@/shell/Sidebar', () => ({
  Sidebar: () => <aside aria-label="Primary sidebar" />,
}));

vi.mock('@/shell/TitleBar', () => ({
  TitleBar: (props: {
    onToggleSidebar: () => void;
    onNavigateBack: () => void;
    onNavigateForward: () => void;
    actionToolbarLeft?: string;
    showEnvironmentToggle?: boolean;
    environmentPanelOpen?: boolean;
    onToggleEnvironmentPanel?: () => void;
  }) => (
    <header
      aria-label="Hermes window titlebar"
      data-action-toolbar-left={props.actionToolbarLeft ?? 'default'}
      data-show-environment-toggle={String(Boolean(props.showEnvironmentToggle))}
      data-environment-panel-open={String(Boolean(props.environmentPanelOpen))}
    >
      <button type="button" onClick={props.onToggleSidebar}>Toggle Sidebar</button>
      <button type="button" onClick={props.onNavigateBack}>Back</button>
      <button type="button" onClick={props.onNavigateForward}>Forward</button>
      {props.showEnvironmentToggle ? (
        <button type="button" onClick={props.onToggleEnvironmentPanel}>
          {props.environmentPanelOpen ? 'Hide Environment panel' : 'Show Environment panel'}
        </button>
      ) : null}
    </header>
  ),
}));

vi.mock('@/shell/ToolDockToolbar', () => ({
  ToolDockToolbar: (props: { terminalCwd?: string | null; terminalTitle?: string | null }) => (
    <div
      role="toolbar"
      aria-label="Tool dock toolbar"
      data-testid="tool-dock-toolbar"
      data-terminal-cwd={props.terminalCwd ?? ''}
      data-terminal-title={props.terminalTitle ?? ''}
    />
  ),
}));

vi.mock('@/features/conversation/RightToolPanel.js', () => ({
  RightToolPanel: (props: {
    contentWidth?: number | null;
    overlay?: boolean;
    resizeMode?: 'live' | 'deferred';
    resizing?: boolean;
    visible?: boolean;
  }) => (
    <aside
      aria-label="Right tools dock"
      data-testid="right-tool-panel"
      data-content-width={props.contentWidth ?? 'none'}
      data-overlay={String(Boolean(props.overlay))}
      data-resize-mode={props.resizeMode ?? 'none'}
      data-resizing={String(Boolean(props.resizing))}
      data-visible={String(props.visible !== false)}
    />
  ),
}));

vi.mock('@/stores/side-panel.js', () => ({
  sidePanelStore: {
    isOpen: () => sidePanelState.open,
    activeView: () => sidePanelState.activeView,
    openTabs: () => sidePanelState.openTabs,
    panelWidth: () => sidePanelState.panelWidth,
    setPanelWidth: sidePanelState.setPanelWidth,
  },
}));

vi.mock('@/shell/CommandPalette', () => ({
  CommandPalette: () => null,
  buildDefaultActions: () => [],
}));

vi.mock('@/stores/session.js', () => ({
  sessionStore: {
    activeSessionId: 'test-session',
    activeSession: { id: 'test-session', cwd: '/repo' },
    createSession: vi.fn(),
    loadSessions: vi.fn().mockResolvedValue(undefined),
    updateSessionTitle: vi.fn(),
    get sessions() { return []; },
  },
}));

vi.mock('@/stores/models.js', () => ({
  modelStore: { hydrateDefaultModel: vi.fn() },
  modelsStore: {
    invalidate: vi.fn(),
    load: vi.fn(),
  },
}));

vi.mock('@/services/keyboard.js', () => ({
  initKeyboardShortcuts: vi.fn(),
  destroyKeyboardShortcuts: vi.fn(),
}));

vi.mock('@/services/api/state.js', () => ({
  loadState: vi.fn(),
}));

vi.mock('@/ui/atoms/LoadingSpinner', () => ({
  LoadingSpinner: () => <span>Loading</span>,
}));

vi.mock('@/stores/context.js', () => ({
  getGateway: () => null,
}));

vi.mock('@/services/notifications/native-notifications.js', () => ({
  setApprovalResponder: vi.fn(),
  setSessionFocuser: vi.fn(),
  teardownNativeNotifications: vi.fn(),
}));

vi.mock('../reasoning-actions.js', () => ({
  cycleActiveReasoningEffort: vi.fn(),
  updateActiveReasoningEffort: vi.fn(),
}));

import { AppLayout } from '../AppLayout.js';
import { uiStore } from '@/stores/ui.js';

let rafCallbacks: FrameRequestCallback[] = [];
let layoutClientWidth = 0;
let layoutResizeCallback: ResizeObserverCallback | undefined;

function flushRaf() {
  const callbacks = rafCallbacks;
  rafCallbacks = [];
  callbacks.forEach((callback) => callback(performance.now()));
}

function stubLayoutResize(initialWidth: number) {
  layoutClientWidth = initialWidth;
  layoutResizeCallback = undefined;

  class ResizeObserverMock {
    constructor(callback: ResizeObserverCallback) {
      layoutResizeCallback = callback;
    }

    observe = (element: Element) => {
      Object.defineProperty(element, 'clientWidth', {
        configurable: true,
        get: () => layoutClientWidth,
      });
    };

    disconnect = vi.fn();
  }

  vi.stubGlobal('ResizeObserver', ResizeObserverMock);
  return (width: number) => {
    layoutClientWidth = width;
    layoutResizeCallback?.([], {} as ResizeObserver);
    flushRaf();
  };
}

describe('AppLayout sidebar titlebar controls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rafCallbacks = [];
    layoutClientWidth = 0;
    layoutResizeCallback = undefined;
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
      rafCallbacks.push(callback);
      return rafCallbacks.length;
    }));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    locationState.pathname = '/conversation/test-session';
    sidePanelState.open = false;
    sidePanelState.activeView = 'menu';
    sidePanelState.openTabs = [];
    sidePanelState.panelWidth = 500;
    sidePanelState.setPanelWidth.mockClear();
    uiStore.setSidebarCollapsed(false);
    uiStore.setSidebarWidth(240);
    uiStore.setEnvironmentPanelOpen(true);
    uiStore.setRightToolsOverlay(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  test('titlebar toggle hides and restores the sidebar', async () => {
    render(() => <AppLayout><div>Conversation</div></AppLayout>);

    const layout = screen.getByTestId('app-layout');
    const sidebarDock = screen.getByTestId('sidebar-dock');
    const workspaceFrame = screen.getByTestId('workspace-frame');
    const splitGrid = screen.getByTestId('workspace-split-grid');
    const contentFrame = screen.getByTestId('workspace-content-frame');

    expect(layout.style.display).toBe('flex');
    expect(layout.style.flexDirection).toBe('row');
    expect(sidebarDock.parentElement).toBe(layout);
    expect(workspaceFrame.parentElement).toBe(layout);
    expect(splitGrid.parentElement).toBe(workspaceFrame);
    expect(splitGrid.style.gridTemplateColumns).toBe('minmax(0, 1fr)');
    expect(contentFrame.style.display).toBe('flex');
    expect(contentFrame.style.paddingRight).toBe('');
    expect(contentFrame.style.boxSizing).toBe('border-box');
    expect(screen.queryByTestId('environment-panel-popover')).toBeNull();
    expect(screen.queryByLabelText('Primary sidebar')).not.toBeNull();
    expect(screen.queryByTestId('left-sidebar-separator')).not.toBeNull();
    expect(screen.getByLabelText('Hermes window titlebar').getAttribute('data-action-toolbar-left')).toBe('var(--space-2)');

    await fireEvent.click(screen.getByRole('button', { name: 'Toggle Sidebar' }));
    expect(screen.queryByLabelText('Primary sidebar')).toBeNull();
    expect(screen.queryByTestId('sidebar-dock')).toBeNull();
    expect(screen.queryByTestId('left-sidebar-separator')).toBeNull();
    expect(screen.getByLabelText('Hermes window titlebar').getAttribute('data-action-toolbar-left')).toBe('default');
    expect(screen.getByLabelText('Hermes window titlebar').getAttribute('data-show-environment-toggle')).toBe('true');

    await fireEvent.click(screen.getByRole('button', { name: 'Toggle Sidebar' }));
    expect(screen.queryByLabelText('Primary sidebar')).not.toBeNull();
    expect(screen.queryByTestId('sidebar-dock')).not.toBeNull();
    expect(screen.queryByTestId('left-sidebar-separator')).not.toBeNull();
  });

  test('settings routes hide the primary app sidebar', () => {
    locationState.pathname = '/settings/general';

    render(() => <AppLayout><div>Settings</div></AppLayout>);

    expect(screen.queryByLabelText('Primary sidebar')).toBeNull();
    expect(screen.queryByTestId('sidebar-dock')).toBeNull();
    expect(screen.queryByTestId('left-sidebar-separator')).toBeNull();
    expect(screen.getByLabelText('Hermes window titlebar').getAttribute('data-action-toolbar-left')).toBe('default');
    expect(screen.getByText('Settings')).not.toBeNull();
    expect(screen.queryByTestId('environment-panel-popover')).toBeNull();
    expect(screen.getByLabelText('Hermes window titlebar').getAttribute('data-show-environment-toggle')).toBe('false');
  });

  test('conversation routes leave the Environment panel to ChatView instead of shell layout', () => {
    sidePanelState.open = false;

    render(() => <AppLayout><div>Conversation</div></AppLayout>);

    expect(screen.queryByTestId('right-tools-dock')).toBeNull();
    expect(screen.queryByTestId('environment-panel-popover')).toBeNull();
    expect(screen.getByTestId('workspace-split-grid').style.gridTemplateColumns).toBe('minmax(0, 1fr)');
    expect(screen.getByTestId('workspace-content-frame').style.paddingRight).toBe('');
  });

  test('titlebar Environment icon toggles shared state independently of tools', async () => {
    sidePanelState.open = false;

    render(() => <AppLayout><div>Conversation</div></AppLayout>);

    expect(uiStore.environmentPanelOpen).toBe(true);
    expect(screen.getByRole('button', { name: 'Hide Environment panel' })).toBeTruthy();

    await fireEvent.click(screen.getByRole('button', { name: 'Hide Environment panel' }));

    expect(uiStore.environmentPanelOpen).toBe(false);
    expect(screen.queryByTestId('right-tools-dock')).toBeNull();
    expect(screen.getByTestId('workspace-content-frame').style.paddingRight).toBe('');
    expect(screen.getByRole('button', { name: 'Show Environment panel' })).toBeTruthy();
  });

  test('conversation routes do not reserve shell space when the split is narrow', async () => {
    const resizeLayout = stubLayoutResize(900);
    sidePanelState.open = false;

    render(() => <AppLayout><div>Conversation</div></AppLayout>);
    resizeLayout(900);

    await waitFor(() => {
      expect(screen.queryByTestId('environment-panel-popover')).toBeNull();
    });
    expect(screen.getByTestId('workspace-split-grid').style.gridTemplateColumns).toBe('minmax(0, 1fr)');
    expect(screen.getByTestId('workspace-content-frame').style.paddingRight).toBe('');
  });

  test('conversation routes render a split-grid right tools pane when open', () => {
    sidePanelState.open = true;

    render(() => <AppLayout><div>Conversation</div></AppLayout>);

    expect(screen.queryByLabelText('Hermes window titlebar')).not.toBeNull();
    expect(screen.queryByLabelText('Right tools dock')).not.toBeNull();
    expect(screen.queryByTestId('right-tools-dock')).not.toBeNull();
    expect(screen.queryByTestId('environment-panel-popover')).toBeNull();
    expect(screen.getByTestId('workspace-split-grid').style.gridTemplateColumns).toBe('minmax(0, 1fr) 500px');
    expect(screen.getByTestId('right-tools-separator').style.top).toBe('0px');
    expect(screen.getByTestId('right-tools-drag-handle').style.top).toBe('0px');
    expect(screen.getByTestId('tool-dock-toolbar').getAttribute('data-terminal-title')).toBe('repo');
    expect(screen.getByTestId('tool-dock-toolbar').getAttribute('data-terminal-cwd')).toBe('/repo');
    expect(screen.getByTestId('right-tool-panel').getAttribute('data-visible')).toBe('true');
  });

  test('keeps terminal tabs mounted without occupying layout when the dock is hidden', () => {
    sidePanelState.open = false;
    sidePanelState.activeView = 'terminal';
    sidePanelState.openTabs = [{ id: 'terminal-1', kind: 'terminal', title: 'repo', cwd: '/repo' }];

    render(() => <AppLayout><div>Conversation</div></AppLayout>);

    expect(screen.queryByTestId('right-tools-dock')).not.toBeNull();
    expect(screen.getByTestId('right-tools-dock').className).toContain('rightToolsPaneHidden');
    expect(screen.getByTestId('right-tool-panel').getAttribute('data-visible')).toBe('false');
    expect(screen.getByTestId('workspace-split-grid').style.gridTemplateColumns).toBe('minmax(0, 1fr)');
    expect(screen.queryByTestId('right-tools-separator')).toBeNull();
    expect(screen.queryByTestId('right-tools-drag-handle')).toBeNull();
  });

  test('settings routes do not render the conversation right tools dock', () => {
    locationState.pathname = '/settings/general';
    sidePanelState.open = true;

    render(() => <AppLayout><div>Settings</div></AppLayout>);

    expect(screen.queryByLabelText('Right tools dock')).toBeNull();
    expect(screen.queryByTestId('environment-panel-popover')).toBeNull();
  });

  test('titlebar back and forward buttons use router history deltas', async () => {
    render(() => <AppLayout><div>Conversation</div></AppLayout>);

    await fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Forward' }));

    expect(navigateMock).toHaveBeenCalledWith(-1);
    expect(navigateMock).toHaveBeenCalledWith(1);
  });

  test('right tools drag coalesces live width through RAF and commits once on mouseup', async () => {
    sidePanelState.open = true;

    render(() => <AppLayout><div>Conversation</div></AppLayout>);

    const splitGrid = screen.getByTestId('workspace-split-grid');
    const innerPanel = screen.getByTestId('right-tool-panel');
    const contentFrame = screen.getByTestId('workspace-content-frame');
    const separator = screen.getByTestId('right-tools-separator');
    const dragHandle = screen.getByTestId('right-tools-drag-handle');
    const titlebar = screen.getByLabelText('Hermes window titlebar');

    expect(splitGrid.style.gridTemplateColumns).toBe('minmax(0, 1fr) 500px');
    expect(contentFrame.style.marginRight).toBe('');
    expect(innerPanel.getAttribute('style') ?? '').toBe('');
    expect(separator.style.right).toBe('500px');
    expect(titlebar.hasAttribute('data-tools-dock-width')).toBe(false);

    await fireEvent.mouseDown(dragHandle, { clientX: 600, button: 0 });
    await fireEvent.mouseMove(document, { clientX: 540 });
    await fireEvent.mouseMove(document, { clientX: 520 });

    expect(splitGrid.style.gridTemplateColumns).toBe('minmax(0, 1fr) 500px');
    expect(contentFrame.style.marginRight).toBe('');
    expect(innerPanel.getAttribute('style') ?? '').toBe('');
    expect(separator.style.right).toBe('500px');
    expect(sidePanelState.setPanelWidth).not.toHaveBeenCalled();

    flushRaf();

    expect(splitGrid.style.gridTemplateColumns).toBe('minmax(0, 1fr) 580px');
    expect(contentFrame.style.marginRight).toBe('');
    expect(innerPanel.getAttribute('style') ?? '').toBe('');
    expect(separator.style.right).toBe('580px');
    expect(sidePanelState.setPanelWidth).not.toHaveBeenCalled();

    await fireEvent.mouseUp(document);

    expect(sidePanelState.setPanelWidth).toHaveBeenCalledTimes(1);
    expect(sidePanelState.setPanelWidth).toHaveBeenCalledWith(580);
    expect(splitGrid.style.gridTemplateColumns).toBe('minmax(0, 1fr) 580px');
  });

  test('right tools drag defers terminal content width until mouseup', async () => {
    sidePanelState.open = true;
    sidePanelState.activeView = 'terminal';
    const resizeLayout = stubLayoutResize(1400);

    render(() => <AppLayout><div>Conversation</div></AppLayout>);
    resizeLayout(1400);

    const splitGrid = screen.getByTestId('workspace-split-grid');
    const innerPanel = screen.getByTestId('right-tool-panel');
    const contentFrame = screen.getByTestId('workspace-content-frame');
    const mainColumn = screen.getByTestId('workspace-main-column');
    const dragHandle = screen.getByTestId('right-tools-drag-handle');

    expect(splitGrid.style.gridTemplateColumns).toBe('minmax(0, 1fr) 500px');
    expect(contentFrame.style.marginRight).toBe('');
    expect(mainColumn.getAttribute('style') ?? '').toBe('');
    expect(innerPanel.getAttribute('data-content-width')).toBe('500');
    expect(innerPanel.getAttribute('data-resize-mode')).toBe('deferred');
    expect(innerPanel.getAttribute('data-resizing')).toBe('false');

    await fireEvent.mouseDown(dragHandle, { clientX: 600, button: 0 });
    await fireEvent.mouseMove(document, { clientX: 520 });
    flushRaf();

    expect(splitGrid.style.gridTemplateColumns).toBe('minmax(0, 1fr) 580px');
    expect(contentFrame.style.marginRight).toBe('');
    expect(mainColumn.getAttribute('style') ?? '').toBe('');
    expect(innerPanel.getAttribute('data-content-width')).toBe('500');
    expect(innerPanel.getAttribute('data-resize-mode')).toBe('deferred');
    expect(innerPanel.getAttribute('data-resizing')).toBe('true');
    expect(sidePanelState.setPanelWidth).not.toHaveBeenCalled();

    await fireEvent.mouseUp(document);

    expect(sidePanelState.setPanelWidth).toHaveBeenCalledWith(580);
    expect(innerPanel.getAttribute('data-content-width')).toBe('580');
    expect(innerPanel.getAttribute('data-resizing')).toBe('false');
  });

  test('right tools drag keeps review content width live during resize', async () => {
    sidePanelState.open = true;
    sidePanelState.activeView = 'review';
    const resizeLayout = stubLayoutResize(1400);

    render(() => <AppLayout><div>Conversation</div></AppLayout>);
    resizeLayout(1400);

    const splitGrid = screen.getByTestId('workspace-split-grid');
    const innerPanel = screen.getByTestId('right-tool-panel');
    const contentFrame = screen.getByTestId('workspace-content-frame');
    const layout = screen.getByTestId('app-layout');
    const mainColumn = screen.getByTestId('workspace-main-column');
    const dragHandle = screen.getByTestId('right-tools-drag-handle');

    expect(splitGrid.style.gridTemplateColumns).toBe('minmax(0, 1fr) 500px');
    expect(contentFrame.style.marginRight).toBe('');
    expect(layout.getAttribute('data-right-tools-dragging')).toBeNull();
    expect(mainColumn.getAttribute('style') ?? '').toBe('');
    expect(innerPanel.getAttribute('data-content-width')).toBe('500');
    expect(innerPanel.getAttribute('data-resize-mode')).toBe('live');
    expect(innerPanel.getAttribute('data-resizing')).toBe('false');

    await fireEvent.mouseDown(dragHandle, { clientX: 600, button: 0 });
    await fireEvent.mouseMove(document, { clientX: 520 });
    flushRaf();

    expect(splitGrid.style.gridTemplateColumns).toBe('minmax(0, 1fr) 580px');
    expect(contentFrame.style.marginRight).toBe('');
    expect(layout.getAttribute('data-right-tools-dragging')).toBe('true');
    expect(mainColumn.style.width).toBe('660px');
    expect(mainColumn.style.flex).toBe('0 0 auto');
    expect(innerPanel.getAttribute('data-content-width')).toBe('580');
    expect(innerPanel.getAttribute('data-resize-mode')).toBe('live');
    expect(innerPanel.getAttribute('data-resizing')).toBe('true');
    expect(sidePanelState.setPanelWidth).not.toHaveBeenCalled();

    await fireEvent.mouseUp(document);

    expect(sidePanelState.setPanelWidth).toHaveBeenCalledWith(580);
    expect(layout.getAttribute('data-right-tools-dragging')).toBeNull();
    expect(mainColumn.getAttribute('style') ?? '').toBe('');
    expect(innerPanel.getAttribute('data-content-width')).toBe('580');
    expect(innerPanel.getAttribute('data-resizing')).toBe('false');
  });

  test('right tools drag blur cancels width and clears the global pointer guard', async () => {
    sidePanelState.open = true;
    sidePanelState.activeView = 'review';
    const resizeLayout = stubLayoutResize(1400);

    render(() => <AppLayout><div>Conversation</div></AppLayout>);
    resizeLayout(1400);

    const splitGrid = screen.getByTestId('workspace-split-grid');
    const layout = screen.getByTestId('app-layout');
    const dragHandle = screen.getByTestId('right-tools-drag-handle');

    await fireEvent.mouseDown(dragHandle, { clientX: 600, button: 0 });
    await fireEvent.mouseMove(document, { clientX: 520 });
    flushRaf();

    expect(splitGrid.style.gridTemplateColumns).toBe('minmax(0, 1fr) 580px');
    expect(layout.getAttribute('data-right-tools-dragging')).toBe('true');
    expect(layout.className).toContain('layoutDragging');

    window.dispatchEvent(new Event('blur'));

    expect(splitGrid.style.gridTemplateColumns).toBe('minmax(0, 1fr) 500px');
    expect(layout.getAttribute('data-right-tools-dragging')).toBeNull();
    expect(layout.className).not.toContain('layoutDragging');
    expect(sidePanelState.setPanelWidth).not.toHaveBeenCalled();
  });

  test('window resize shrinks the dock before entering overlay without persisting panel width', async () => {
    const resizeLayout = stubLayoutResize(1240);
    sidePanelState.open = true;

    render(() => <AppLayout><div>Conversation</div></AppLayout>);
    resizeLayout(1240);

    await waitFor(() => {
      expect(screen.getByTestId('workspace-split-grid').style.gridTemplateColumns).toBe('minmax(0, 1fr) 439px');
    });
    expect(screen.getByTestId('workspace-content-frame').style.marginRight).toBe('');
    expect(screen.getByTestId('right-tool-panel').getAttribute('data-overlay')).toBe('false');
    expect(sidePanelState.setPanelWidth).not.toHaveBeenCalled();
  });

  test('right tools overlay uses hysteresis while resizing near the split threshold', async () => {
    const resizeLayout = stubLayoutResize(1180);
    sidePanelState.open = true;

    render(() => <AppLayout><div>Conversation</div></AppLayout>);
    resizeLayout(1180);

    await waitFor(() => {
      expect(screen.getByTestId('right-tool-panel').getAttribute('data-overlay')).toBe('true');
    });
    expect(screen.queryByTestId('right-tools-separator')).toBeNull();
    expect(screen.queryByTestId('right-tools-drag-handle')).toBeNull();
    expect(screen.getByTestId('tool-dock-toolbar')).toBeTruthy();
    expect(screen.getByTestId('right-tools-content')).toBeTruthy();
    expect(uiStore.rightToolsOverlay).toBe(true);

    resizeLayout(1200);
    await waitFor(() => {
      expect(screen.getByTestId('right-tool-panel').getAttribute('data-overlay')).toBe('true');
    });

    resizeLayout(1230);
    await waitFor(() => {
      expect(screen.getByTestId('right-tool-panel').getAttribute('data-overlay')).toBe('false');
    });
    expect(uiStore.rightToolsOverlay).toBe(false);
    expect(screen.queryByTestId('right-tools-separator')).not.toBeNull();
  });

  test('window resize marks the layout as resizing during the resize frame', async () => {
    const resizeLayout = stubLayoutResize(1300);
    sidePanelState.open = true;

    render(() => <AppLayout><div>Conversation</div></AppLayout>);
    resizeLayout(1300);
    const layout = screen.getByTestId('app-layout');

    resizeLayout(1240);

    await waitFor(() => {
      expect(layout.className).toContain('layoutResizing');
    });
  });

  test('left sidebar drag coalesces live width through RAF and persists once on mouseup', async () => {
    const setSidebarWidth = vi.spyOn(uiStore, 'setSidebarWidth');

    render(() => <AppLayout><div>Conversation</div></AppLayout>);

    const dock = screen.getByTestId('sidebar-dock');
    const separator = screen.getByTestId('left-sidebar-separator');
    const dragHandle = screen.getByTestId('left-sidebar-drag-handle');

    expect(dock.style.width).toBe('240px');
    expect(separator.style.left).toBe('240px');

    await fireEvent.mouseDown(dragHandle, { clientX: 240, button: 0 });
    await fireEvent.mouseMove(document, { clientX: 280 });
    await fireEvent.mouseMove(document, { clientX: 300 });

    expect(dock.style.width).toBe('240px');
    expect(separator.style.left).toBe('240px');
    expect(setSidebarWidth).not.toHaveBeenCalled();

    flushRaf();

    expect(dock.style.width).toBe('300px');
    expect(separator.style.left).toBe('300px');
    expect(setSidebarWidth).not.toHaveBeenCalled();

    await fireEvent.mouseUp(document);

    expect(setSidebarWidth).toHaveBeenCalledTimes(1);
    expect(setSidebarWidth).toHaveBeenCalledWith(300);
  });

  test('left sidebar drag blur cancels width and clears the global pointer guard', async () => {
    const setSidebarWidth = vi.spyOn(uiStore, 'setSidebarWidth');

    render(() => <AppLayout><div>Conversation</div></AppLayout>);

    const layout = screen.getByTestId('app-layout');
    const dock = screen.getByTestId('sidebar-dock');
    const separator = screen.getByTestId('left-sidebar-separator');
    const dragHandle = screen.getByTestId('left-sidebar-drag-handle');

    await fireEvent.mouseDown(dragHandle, { clientX: 240, button: 0 });
    await fireEvent.mouseMove(document, { clientX: 300 });
    flushRaf();

    expect(dock.style.width).toBe('300px');
    expect(separator.style.left).toBe('300px');
    expect(layout.className).toContain('layoutDragging');

    window.dispatchEvent(new Event('blur'));

    expect(dock.style.width).toBe('240px');
    expect(separator.style.left).toBe('240px');
    expect(layout.className).not.toContain('layoutDragging');
    expect(setSidebarWidth).not.toHaveBeenCalled();
  });
});
