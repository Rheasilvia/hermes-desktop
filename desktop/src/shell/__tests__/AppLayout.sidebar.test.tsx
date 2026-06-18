import { render, fireEvent, screen, waitFor } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const { navigateMock, locationState } = vi.hoisted(() => ({
  navigateMock: vi.fn(),
  locationState: { pathname: '/conversation/test-session' },
}));

const { sidePanelState } = vi.hoisted(() => ({
  sidePanelState: {
    open: false,
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
    toolsDockWidth?: number | null;
  }) => (
    <header
      aria-label="Hermes window titlebar"
      data-action-toolbar-left={props.actionToolbarLeft ?? 'default'}
      data-tools-dock-width={props.toolsDockWidth ?? 'none'}
    >
      <button type="button" onClick={props.onToggleSidebar}>Toggle Sidebar</button>
      <button type="button" onClick={props.onNavigateBack}>Back</button>
      <button type="button" onClick={props.onNavigateForward}>Forward</button>
    </header>
  ),
}));

vi.mock('@/features/conversation/RightToolPanel.js', () => ({
  RightToolPanel: (props: {
    overlay?: boolean;
  }) => (
    <aside
      aria-label="Right tools dock"
      data-testid="right-tool-panel"
      data-overlay={String(Boolean(props.overlay))}
    />
  ),
}));

vi.mock('@/stores/side-panel.js', () => ({
  sidePanelStore: {
    isOpen: () => sidePanelState.open,
    activeView: () => 'menu',
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
    sidePanelState.panelWidth = 500;
    sidePanelState.setPanelWidth.mockClear();
    uiStore.setSidebarCollapsed(false);
    uiStore.setSidebarWidth(240);
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
    const contentFrame = screen.getByTestId('workspace-content-frame');

    expect(layout.style.display).toBe('flex');
    expect(layout.style.flexDirection).toBe('row');
    expect(sidebarDock.parentElement).toBe(layout);
    expect(workspaceFrame.parentElement).toBe(layout);
    expect(workspaceFrame.style.flexDirection).toBe('column');
    expect(contentFrame.style.display).toBe('flex');
    expect(screen.queryByLabelText('Primary sidebar')).not.toBeNull();
    expect(screen.queryByTestId('left-sidebar-separator')).not.toBeNull();
    expect(screen.getByLabelText('Hermes window titlebar').getAttribute('data-action-toolbar-left')).toBe('var(--space-2)');

    await fireEvent.click(screen.getByRole('button', { name: 'Toggle Sidebar' }));
    expect(screen.queryByLabelText('Primary sidebar')).toBeNull();
    expect(screen.queryByTestId('sidebar-dock')).toBeNull();
    expect(screen.queryByTestId('left-sidebar-separator')).toBeNull();
    expect(screen.getByLabelText('Hermes window titlebar').getAttribute('data-action-toolbar-left')).toBe('default');

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
  });

  test('conversation routes render the window-top right tools dock when open', () => {
    sidePanelState.open = true;

    render(() => <AppLayout><div>Conversation</div></AppLayout>);

    expect(screen.queryByLabelText('Hermes window titlebar')).not.toBeNull();
    expect(screen.queryByLabelText('Right tools dock')).not.toBeNull();
    expect(screen.queryByTestId('right-tools-dock')).not.toBeNull();
    expect(screen.queryByTestId('right-tools-separator')).not.toBeNull();
    expect(screen.queryByTestId('right-tools-drag-handle')).not.toBeNull();
    expect(screen.getByLabelText('Hermes window titlebar').getAttribute('data-tools-dock-width')).toBe('500');
  });

  test('settings routes do not render the conversation right tools dock', () => {
    locationState.pathname = '/settings/general';
    sidePanelState.open = true;

    render(() => <AppLayout><div>Settings</div></AppLayout>);

    expect(screen.queryByLabelText('Right tools dock')).toBeNull();
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

    const dock = screen.getByTestId('right-tools-dock');
    const innerPanel = screen.getByTestId('right-tool-panel');
    const contentFrame = screen.getByTestId('workspace-content-frame');
    const dragHandle = screen.getByTestId('right-tools-drag-handle');

    expect(dock.style.width).toBe('500px');
    expect(contentFrame.style.marginRight).toBe('501px');
    expect(innerPanel.getAttribute('style') ?? '').toBe('');

    await fireEvent.mouseDown(dragHandle, { clientX: 600, button: 0 });
    await fireEvent.mouseMove(document, { clientX: 540 });
    await fireEvent.mouseMove(document, { clientX: 520 });

    expect(dock.style.width).toBe('500px');
    expect(contentFrame.style.marginRight).toBe('501px');
    expect(innerPanel.getAttribute('style') ?? '').toBe('');
    expect(sidePanelState.setPanelWidth).not.toHaveBeenCalled();

    flushRaf();

    expect(dock.style.width).toBe('580px');
    expect(contentFrame.style.marginRight).toBe('581px');
    expect(innerPanel.getAttribute('style') ?? '').toBe('');
    expect(sidePanelState.setPanelWidth).not.toHaveBeenCalled();

    await fireEvent.mouseUp(document);

    expect(sidePanelState.setPanelWidth).toHaveBeenCalledTimes(1);
    expect(sidePanelState.setPanelWidth).toHaveBeenCalledWith(580);
  });

  test('window resize shrinks the dock before entering overlay without persisting panel width', async () => {
    const resizeLayout = stubLayoutResize(1240);
    sidePanelState.open = true;

    render(() => <AppLayout><div>Conversation</div></AppLayout>);
    resizeLayout(1240);

    await waitFor(() => {
      expect(screen.getByTestId('right-tools-dock').style.width).toBe('439px');
    });
    expect(screen.getByTestId('workspace-content-frame').style.marginRight).toBe('440px');
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

    resizeLayout(1200);
    await waitFor(() => {
      expect(screen.getByTestId('right-tool-panel').getAttribute('data-overlay')).toBe('true');
    });

    resizeLayout(1230);
    await waitFor(() => {
      expect(screen.getByTestId('right-tool-panel').getAttribute('data-overlay')).toBe('false');
    });
    expect(screen.queryByTestId('right-tools-separator')).not.toBeNull();
  });

  test('window resize disables main-frame margin transitions during the resize frame', async () => {
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
});
