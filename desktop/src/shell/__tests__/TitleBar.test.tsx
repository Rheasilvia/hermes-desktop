import { render, fireEvent, screen } from '@solidjs/testing-library';
import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';

// --- Mock state hoisted so vi.mock factories can read it ----------------------
const windowMock = vi.hoisted(() => {
  const calls = { minimize: 0, startDragging: 0, toggleMaximize: 0, close: 0, isMaximized: 0 };
  return {
    calls,
    isMaximized: false,
    win: {
      minimize: async () => { calls.minimize += 1; },
      startDragging: async () => { calls.startDragging += 1; },
      toggleMaximize: async () => { calls.toggleMaximize += 1; },
      close: async () => { calls.close += 1; },
      isMaximized: async () => { calls.isMaximized += 1; return windowMock.isMaximized; },
      onResized: async () => async () => { /* noop unlisten */ },
    },
  };
});

const { sidePanelState, sidePanelToggle, sidePanelOpenTab, sidePanelSetActiveView } = vi.hoisted(() => ({
  sidePanelState: {
    open: false,
    activeView: 'menu',
    openTabs: [] as string[],
  },
  sidePanelToggle: vi.fn(),
  sidePanelOpenTab: vi.fn((view: string) => {
    if (!sidePanelState.openTabs.includes(view)) {
      sidePanelState.openTabs.push(view);
    }
    sidePanelState.activeView = view;
    sidePanelState.open = true;
  }),
  sidePanelSetActiveView: vi.fn((view: string) => {
    if (view !== 'menu' && !sidePanelState.openTabs.includes(view)) {
      sidePanelState.openTabs.push(view);
    }
    sidePanelState.activeView = view;
  }),
}));

// isTauri is imported statically at the top of TitleBar.tsx, so the core module
// must be mocked before the component loads.
vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => true,
  invoke: async () => 'macos',
}));

vi.mock('@/stores/session.js', () => ({
  sessionStore: {
    activeSession: null,
  },
}));

vi.mock('@/stores/side-panel.js', () => ({
  sidePanelStore: {
    isOpen: () => sidePanelState.open,
    activeView: () => sidePanelState.activeView,
    openTabs: () => sidePanelState.openTabs,
    toggle: sidePanelToggle,
    openTab: sidePanelOpenTab,
    setActiveView: sidePanelSetActiveView,
  },
}));

// Stub the Tauri internals the real @tauri-apps/api/window module reads when
// constructing a Window. getCurrentWindow() builds `new Window(label, ...)`,
// and the Window class delegates every IPC through __TAURI_INTERNALS__.invoke
// with `plugin:window|<command>` names. We intercept those so the real Window
// object is returned but its methods resolve to our spy counters.
beforeEach(() => {
  (globalThis as any).__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: 'main' } },
    invoke: async (cmd: string) => {
      switch (cmd) {
        case 'plugin:window|minimize': { windowMock.calls.minimize += 1; return null; }
        case 'plugin:window|start_dragging': { windowMock.calls.startDragging += 1; return null; }
        case 'plugin:window|toggle_maximize': { windowMock.calls.toggleMaximize += 1; return null; }
        case 'plugin:window|close': { windowMock.calls.close += 1; return null; }
        case 'plugin:window|is_maximized': { windowMock.calls.isMaximized += 1; return windowMock.isMaximized; }
        default: return null;
      }
    },
    transformCallback: () => 0,
    convertFileSrc: (p: string) => p,
    unregisterCallback: () => {},
  };
  // The event module (used by Window.onResized) reads a separate internals bag
  // when unregistering a listener at teardown. Provide it so cleanup is clean.
  (globalThis as any).__TAURI_EVENT_PLUGIN_INTERNALS__ = {
    unregisterListener: () => {},
  };
});

// Import AFTER mocks are registered.
import { TitleBar } from '../TitleBar.js';
import { uiStore } from '@/stores/ui.js';
import { sessionStore } from '@/stores/session.js';
import { sidePanelStore } from '@/stores/side-panel.js';

function getNavigationToolbar() {
  return screen.getByRole('toolbar', { name: 'Window navigation' });
}

function renderTitleBar(overrides: Partial<Parameters<typeof TitleBar>[0]> = {}) {
  const props = {
    onToggleSidebar: vi.fn(),
    onNavigateBack: vi.fn(),
    onNavigateForward: vi.fn(),
    onNewSession: vi.fn(),
    ...overrides,
  };
  const result = render(() => <TitleBar {...props} />);
  return { ...result, props };
}

describe('TitleBar', () => {
  beforeEach(() => {
    windowMock.calls.minimize = 0;
    windowMock.calls.startDragging = 0;
    windowMock.calls.toggleMaximize = 0;
    windowMock.calls.close = 0;
    windowMock.calls.isMaximized = 0;
    windowMock.isMaximized = false;
    uiStore.setPlatform('unknown');
    uiStore.setSidebarCollapsed(false);
    (sessionStore as any).activeSession = null;
    sidePanelState.open = false;
    sidePanelState.activeView = 'menu';
    sidePanelState.openTabs = [];
    sidePanelToggle.mockReset();
    sidePanelOpenTab.mockClear();
    sidePanelSetActiveView.mockClear();
    (sidePanelStore as any).isOpen = () => sidePanelState.open;
    (sidePanelStore as any).activeView = () => sidePanelState.activeView;
    (sidePanelStore as any).openTabs = () => sidePanelState.openTabs;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('the outer title bar carries the Tauri drag region attribute', () => {
    const { container } = renderTitleBar();
    const dragRegions = container.querySelectorAll('[data-tauri-drag-region]');
    const titleBar = screen.getByLabelText('Hermes window titlebar');

    expect(dragRegions).toHaveLength(1);
    expect(dragRegions[0]).toBe(titleBar);
    expect(getNavigationToolbar().hasAttribute('data-tauri-drag-region')).toBe(false);
    expect(screen.getByTitle('Toggle Sidebar').hasAttribute('data-tauri-drag-region')).toBe(false);
  });

  test.each(['macos', 'unknown', 'windows', 'linux'] as const)(
    '%s: renders the fixed left navigation toolbar without the text brand',
    (platform) => {
      uiStore.setPlatform(platform);
      const { container } = renderTitleBar();
      const toolbar = getNavigationToolbar();

      expect(toolbar.style.left).toBe('85px');
      expect(screen.getByTitle('Toggle Sidebar')).not.toBeNull();
      expect(screen.getByTitle('Back')).not.toBeNull();
      expect(screen.getByTitle('Forward')).not.toBeNull();
      expect(screen.queryByText('Hermes')).toBeNull();
      expect(container.querySelector('[data-tauri-drag-region][aria-hidden="true"]')).toBeNull();
    },
  );

  test('macOS and unknown platform render no custom window controls', () => {
    uiStore.setPlatform('macos');
    renderTitleBar();

    expect(screen.queryByTitle('Minimize')).toBeNull();
    expect(screen.queryByTitle('Maximize')).toBeNull();
    expect(screen.queryByTitle('Close')).toBeNull();
  });

  test.each(['windows', 'linux'] as const)('%s: renders the three custom window controls', (platform) => {
    uiStore.setPlatform(platform);
    const { container } = renderTitleBar();
    expect(container.querySelector('[data-tauri-drag-region][aria-hidden="true"]')).toBeNull();
    expect(screen.getByTitle('Minimize')).not.toBeNull();
    expect(screen.getByTitle('Maximize')).not.toBeNull();
    expect(screen.getByTitle('Close')).not.toBeNull();
  });

  test('unknown initial platform renders no custom window controls', () => {
    uiStore.setPlatform('unknown');
    renderTitleBar();

    expect(screen.queryByTitle('Minimize')).toBeNull();
    expect(screen.queryByTitle('Maximize')).toBeNull();
    expect(screen.queryByTitle('Close')).toBeNull();
  });

  test('dragging the titlebar starts native window dragging', async () => {
    uiStore.setPlatform('macos');
    renderTitleBar();

    await fireEvent.mouseDown(screen.getByLabelText('Hermes window titlebar'), { button: 0 });

    await vi.waitFor(() => {
      expect(windowMock.calls.startDragging).toBe(1);
    });
  });

  test('right-clicking the titlebar does not start native window dragging', async () => {
    uiStore.setPlatform('macos');
    renderTitleBar();

    await fireEvent.mouseDown(screen.getByLabelText('Hermes window titlebar'), { button: 2 });

    expect(windowMock.calls.startDragging).toBe(0);
  });

  test('double-clicking the titlebar toggles native maximize and restore behavior', async () => {
    uiStore.setPlatform('macos');
    renderTitleBar();

    await fireEvent.dblClick(screen.getByLabelText('Hermes window titlebar'), { button: 0 });

    await vi.waitFor(() => {
      expect(windowMock.calls.toggleMaximize).toBe(1);
    });
  });

  test('double-clicking titlebar controls does not toggle maximize', async () => {
    uiStore.setPlatform('macos');
    renderTitleBar();

    await fireEvent.dblClick(screen.getByTitle('Toggle Sidebar'), { button: 0 });

    expect(windowMock.calls.toggleMaximize).toBe(0);
  });

  test('pressing navigation toolbar buttons does not start native window dragging', async () => {
    uiStore.setPlatform('macos');
    renderTitleBar();

    await fireEvent.mouseDown(screen.getByTitle('Toggle Sidebar'), { button: 0 });
    await fireEvent.mouseDown(screen.getByTitle('Back'), { button: 0 });
    await fireEvent.mouseDown(screen.getByTitle('Forward'), { button: 0 });

    expect(windowMock.calls.startDragging).toBe(0);
  });

  test('pressing custom window control buttons does not start native window dragging', async () => {
    uiStore.setPlatform('windows');
    renderTitleBar();

    await fireEvent.mouseDown(screen.getByTitle('Minimize'), { button: 0 });

    expect(windowMock.calls.startDragging).toBe(0);
  });

  test('clicking titlebar navigation buttons calls the provided app callbacks', async () => {
    uiStore.setPlatform('macos');
    const { props } = renderTitleBar();

    await fireEvent.click(screen.getByTitle('Toggle Sidebar'));
    await fireEvent.click(screen.getByTitle('Back'));
    await fireEvent.click(screen.getByTitle('Forward'));

    expect(props.onToggleSidebar).toHaveBeenCalledTimes(1);
    expect(props.onNavigateBack).toHaveBeenCalledTimes(1);
    expect(props.onNavigateForward).toHaveBeenCalledTimes(1);
    expect(windowMock.calls.startDragging).toBe(0);
  });

  test('toggling the sidebar does not move the fixed navigation toolbar', async () => {
    uiStore.setPlatform('macos');
    const onToggleSidebar = vi.fn(() => uiStore.toggleSidebar());
    const { props } = renderTitleBar({
      onToggleSidebar,
    });
    const toolbar = getNavigationToolbar();

    expect(toolbar.style.left).toBe('85px');
    expect(uiStore.sidebarCollapsed).toBe(false);

    await fireEvent.click(screen.getByTitle('Toggle Sidebar'));

    expect(props.onToggleSidebar).toHaveBeenCalledTimes(1);
    expect(uiStore.sidebarCollapsed).toBe(true);
    expect(toolbar.style.left).toBe('85px');
  });

  test('accepts a shell-provided navigation toolbar inset', () => {
    renderTitleBar({ actionToolbarLeft: 'var(--space-2)' });

    expect(getNavigationToolbar().style.left).toBe('var(--space-2)');
  });

  test('clicking minimize/toggleMaximize/close drives the Tauri window handle', async () => {
    uiStore.setPlatform('windows');
    renderTitleBar();

    await fireEvent.click(screen.getByTitle('Minimize'));
    await fireEvent.click(screen.getByTitle('Maximize'));
    await fireEvent.click(screen.getByTitle('Close'));

    // Click handlers await a dynamic import of the window module before invoking
    // the IPC, so settle the microtask queue before asserting.
    await vi.waitFor(() => {
      expect(windowMock.calls.minimize).toBe(1);
      expect(windowMock.calls.toggleMaximize).toBe(1);
      expect(windowMock.calls.close).toBe(1);
    });
    expect(windowMock.calls.startDragging).toBe(0);
  });

  test('session title renders when active session has a title', () => {
    (sessionStore as any).activeSession = { title: 'Debugging PR #42' };
    renderTitleBar();

    expect(screen.getByText('Debugging PR #42')).toBeTruthy();
  });

  test('session title carries the native title attribute for full-text hover tooltip', () => {
    (sessionStore as any).activeSession = { title: 'A very long session title that should be truncated' };
    renderTitleBar();

    const titleEl = screen.getByText('A very long session title that should be truncated');
    expect(titleEl.getAttribute('title')).toBe('A very long session title that should be truncated');
  });

  test('session title is hidden when no active session', () => {
    (sessionStore as any).activeSession = null;
    renderTitleBar();

    expect(screen.queryByText('Debugging PR #42')).toBeNull();
  });

  test('dragging on the session title text starts native window dragging', async () => {
    (sessionStore as any).activeSession = { title: 'Test Session' };
    uiStore.setPlatform('macos');
    renderTitleBar();

    await fireEvent.mouseDown(screen.getByText('Test Session'), { button: 0 });

    await vi.waitFor(() => {
      expect(windowMock.calls.startDragging).toBe(1);
    });
  });

  test('double-clicking on the session title toggles maximize', async () => {
    (sessionStore as any).activeSession = { title: 'Test Session' };
    uiStore.setPlatform('macos');
    renderTitleBar();

    await fireEvent.dblClick(screen.getByText('Test Session'), { button: 0 });

    await vi.waitFor(() => {
      expect(windowMock.calls.toggleMaximize).toBe(1);
    });
  });

  
  test('new chat button appears when sidebar is collapsed and triggers onNewSession', () => {
    uiStore.setSidebarCollapsed(true);
    const { props } = renderTitleBar();

    const btn = screen.getByRole('button', { name: 'New Chat' });
    expect(btn).toBeTruthy();

    fireEvent.click(btn);
    expect(props.onNewSession).toHaveBeenCalledTimes(1);
  });

  test('new chat button is hidden when sidebar is expanded', () => {
    uiStore.setSidebarCollapsed(false);
    renderTitleBar();

    expect(screen.queryByRole('button', { name: 'New Chat' })).toBeNull();
  });

test('tools dock toggle button renders with correct aria-label when closed', () => {
    sidePanelState.open = false;
    sidePanelToggle.mockReset();
    renderTitleBar();

    const btn = screen.getByRole('button', { name: 'Show tools dock' });
    expect(btn).toBeTruthy();
  });

  test('tools dock toggle button reflects active state when dock is open', () => {
    sidePanelState.open = true;
    sidePanelToggle.mockReset();
    renderTitleBar();

    const btn = screen.getByRole('button', { name: 'Hide tools dock' });
    expect(btn).toBeTruthy();
  });

  test('clicking tools dock toggle calls sidePanelStore toggle', () => {
    sidePanelState.open = false;
    sidePanelToggle.mockReset();
    renderTitleBar();

    fireEvent.click(screen.getByRole('button', { name: 'Show tools dock' }));

    expect(sidePanelToggle).toHaveBeenCalledWith();
  });

  test('toggling the tools dock does not move the fixed navigation toolbar', () => {
    sidePanelState.open = false;
    sidePanelToggle.mockReset();
    renderTitleBar();
    const toolbar = getNavigationToolbar();

    expect(toolbar.style.left).toBe('85px');

    fireEvent.click(screen.getByRole('button', { name: 'Show tools dock' }));

    expect(sidePanelToggle).toHaveBeenCalledWith();
    expect(toolbar.style.left).toBe('85px');
  });

  test('tools tabs render inside the right group when the dock is open', () => {
    sidePanelState.open = true;
    sidePanelState.activeView = 'terminal';
    sidePanelState.openTabs = ['terminal', 'files'];

    renderTitleBar({ toolsDockWidth: 500 });

    expect(screen.getByTestId('titlebar-right-group').style.width).toBe('500px');
    expect(screen.getByRole('tablist', { name: 'Tool tabs' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Terminal' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tab', { name: 'Open file' }).getAttribute('aria-selected')).toBe('false');
    expect(screen.getByRole('button', { name: 'Add tool tab' })).toBeTruthy();
  });

  test('tools plus menu creates or activates titlebar tabs', () => {
    sidePanelState.open = true;
    sidePanelState.activeView = 'terminal';
    sidePanelState.openTabs = ['terminal'];

    renderTitleBar({ toolsDockWidth: 500 });

    fireEvent.click(screen.getByRole('button', { name: 'Add tool tab' }));
    expect(screen.getByRole('menuitem', { name: /Review/ })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: /Terminal/ })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: /Open file/ })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: /Delegation/ })).toBeTruthy();

    fireEvent.click(screen.getByRole('menuitem', { name: /Open file/ }));

    expect(sidePanelOpenTab).toHaveBeenCalledWith('files');
    expect(sidePanelState.openTabs).toEqual(['terminal', 'files']);
    expect(sidePanelState.activeView).toBe('files');
  });
});
