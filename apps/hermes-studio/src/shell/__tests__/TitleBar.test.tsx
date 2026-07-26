import { render, fireEvent, screen } from '@solidjs/testing-library';
import { createRoot, createSignal } from 'solid-js';
import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';
import { installNativeHostMock } from '@/services/native-host.js';
import type { HermesStudioBridge, NativeWindowState } from '@/shared/native-bridge.js';

// --- Mock state hoisted so vi.mock factories can read it ----------------------
const windowMock = vi.hoisted(() => {
  const calls = { minimize: 0, startDrag: 0, toggleMaximize: 0, close: 0, state: 0 };
  return {
    calls,
    currentState: { focused: true, maximized: false, minimized: false },
    pendingState: null as Promise<NativeWindowState> | null,
    stateListeners: [] as Array<(state: NativeWindowState) => void>,
  };
});

const {
  sidePanelState,
  sidePanelToggle,
  sidePanelOpenTab,
  sidePanelSetActiveView,
  sidePanelCloseTab,
  sidePanelRequestToolMenuOpen,
} = vi.hoisted(() => ({
  sidePanelState: {
    _open: false,
    _activeView: 'menu',
    _openTabs: [] as string[],
    _readOpen: undefined as undefined | (() => boolean),
    _writeOpen: undefined as undefined | ((open: boolean) => void),
    _readActiveView: undefined as undefined | (() => string),
    _writeActiveView: undefined as undefined | ((view: string) => void),
    _readOpenTabs: undefined as undefined | (() => string[]),
    _writeOpenTabs: undefined as undefined | ((tabs: string[]) => void),
    get open() {
      return this._open;
    },
    set open(open: boolean) {
      this._open = open;
      this._writeOpen?.(open);
    },
    get activeView() {
      return this._activeView;
    },
    set activeView(view: string) {
      this._activeView = view;
      this._writeActiveView?.(view);
    },
    get openTabs() {
      return this._openTabs;
    },
    set openTabs(tabs: string[]) {
      this._openTabs = tabs;
      this._writeOpenTabs?.(tabs);
    },
    readOpen() {
      return this._readOpen?.() ?? this._open;
    },
    readActiveView() {
      return this._readActiveView?.() ?? this._activeView;
    },
    readOpenTabs() {
      return this._readOpenTabs?.() ?? this._openTabs;
    },
  },
  sidePanelToggle: vi.fn(() => {
    sidePanelState.open = !sidePanelState.open;
    if (sidePanelState.open) sidePanelState.activeView = 'menu';
  }),
  sidePanelOpenTab: vi.fn((view: string) => {
    if (!sidePanelState.openTabs.includes(view)) {
      sidePanelState.openTabs = [...sidePanelState.openTabs, view];
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
  sidePanelCloseTab: vi.fn((view: string) => {
    const next = sidePanelState.openTabs.filter((tab) => tab !== view);
    sidePanelState.openTabs = next;
    if (sidePanelState.activeView === view) {
      sidePanelState.activeView = next[0] ?? 'menu';
    }
    if (next.length === 0) {
      sidePanelState.open = false;
    }
  }),
  sidePanelRequestToolMenuOpen: vi.fn(),
}));

vi.mock('@/stores/session.js', () => ({
  sessionStore: {
    activeSession: null,
  },
}));

vi.mock('@/stores/side-panel.js', () => ({
  sidePanelStore: {
    isOpen: () => sidePanelState.readOpen(),
    activeView: () => sidePanelState.readActiveView(),
    openTabs: () => sidePanelState.readOpenTabs(),
    toggle: sidePanelToggle,
    openTab: sidePanelOpenTab,
    setActiveView: sidePanelSetActiveView,
    closeTab: sidePanelCloseTab,
    requestToolMenuOpen: sidePanelRequestToolMenuOpen,
  },
}));

import { TitleBar } from '../TitleBar.js';
import { uiStore } from '@/stores/ui.js';
import { sessionStore } from '@/stores/session.js';
import { sidePanelStore } from '@/stores/side-panel.js';

let disposeSidePanelSignals: (() => void) | undefined;

function installSidePanelSignals() {
  disposeSidePanelSignals?.();
  createRoot((dispose) => {
    disposeSidePanelSignals = dispose;
    const [open, setOpen] = createSignal(sidePanelState.open);
    const [activeView, setActiveView] = createSignal(sidePanelState.activeView);
    const [openTabs, setOpenTabs] = createSignal(sidePanelState.openTabs);
    sidePanelState._readOpen = open;
    sidePanelState._writeOpen = setOpen;
    sidePanelState._readActiveView = activeView;
    sidePanelState._writeActiveView = setActiveView;
    sidePanelState._readOpenTabs = openTabs;
    sidePanelState._writeOpenTabs = setOpenTabs;
  });
}

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
  let restoreNativeHost = () => {};

  beforeEach(() => {
    restoreNativeHost();
    restoreNativeHost = installNativeHostMock({
      window: {
        minimize: async () => { windowMock.calls.minimize += 1; },
        startDrag: async () => { windowMock.calls.startDrag += 1; },
        toggleMaximize: async () => { windowMock.calls.toggleMaximize += 1; },
        close: async () => { windowMock.calls.close += 1; },
        focus: async () => {},
        state: async () => {
          windowMock.calls.state += 1;
          if (windowMock.pendingState) return windowMock.pendingState;
          return { ...windowMock.currentState };
        },
        onFocus: () => () => {},
        onState: (callback: (state: NativeWindowState) => void) => {
          windowMock.stateListeners.push(callback);
          return () => {
            windowMock.stateListeners = windowMock.stateListeners.filter((item) => item !== callback);
          };
        },
      },
    } as unknown as HermesStudioBridge);
    installSidePanelSignals();
    windowMock.calls.minimize = 0;
    windowMock.calls.startDrag = 0;
    windowMock.calls.toggleMaximize = 0;
    windowMock.calls.close = 0;
    windowMock.calls.state = 0;
    windowMock.currentState = { focused: true, maximized: false, minimized: false };
    windowMock.pendingState = null;
    windowMock.stateListeners = [];
    uiStore.setPlatform('unknown');
    uiStore.setSidebarCollapsed(false);
    (sessionStore as any).activeSession = null;
    sidePanelState.open = false;
    sidePanelState.activeView = 'menu';
    sidePanelState.openTabs = [];
    sidePanelToggle.mockReset();
    sidePanelToggle.mockImplementation(() => {
      sidePanelState.open = !sidePanelState.open;
      if (sidePanelState.open) sidePanelState.activeView = 'menu';
    });
    sidePanelOpenTab.mockClear();
    sidePanelSetActiveView.mockClear();
    sidePanelCloseTab.mockClear();
    sidePanelRequestToolMenuOpen.mockClear();
    (sidePanelStore as any).isOpen = () => sidePanelState.readOpen();
    (sidePanelStore as any).activeView = () => sidePanelState.readActiveView();
    (sidePanelStore as any).openTabs = () => sidePanelState.readOpenTabs();
  });

  afterEach(() => {
    restoreNativeHost();
    restoreNativeHost = () => {};
    disposeSidePanelSignals?.();
    disposeSidePanelSignals = undefined;
    vi.restoreAllMocks();
  });

  test('the title bar uses CSS drag regions without native drag attributes', () => {
    renderTitleBar();
    const titleBar = screen.getByLabelText('Hermes window titlebar');

    expect(titleBar.className).toContain('titleBar');
    expect(titleBar.getAttributeNames()).toEqual(expect.arrayContaining(['class', 'aria-label']));
  });

  test.each(['macos', 'unknown', 'windows', 'linux'] as const)(
    '%s: renders the fixed left navigation toolbar without the text brand',
    (platform) => {
      uiStore.setPlatform(platform);
      renderTitleBar();
      const toolbar = getNavigationToolbar();

      expect(toolbar.style.left).toBe('85px');
      expect(screen.getByTitle('Toggle Sidebar')).not.toBeNull();
      expect(screen.getByTitle('Back')).not.toBeNull();
      expect(screen.getByTitle('Forward')).not.toBeNull();
      expect(screen.queryByText('Hermes')).toBeNull();
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
    renderTitleBar();
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

  test('dragging the titlebar never calls the imperative startDrag bridge', async () => {
    uiStore.setPlatform('macos');
    renderTitleBar();

    await fireEvent.mouseDown(screen.getByLabelText('Hermes window titlebar'), { button: 0 });

    expect(windowMock.calls.startDrag).toBe(0);
  });

  test('right-clicking the titlebar does not start native window dragging', async () => {
    uiStore.setPlatform('macos');
    renderTitleBar();

    await fireEvent.mouseDown(screen.getByLabelText('Hermes window titlebar'), { button: 2 });

    expect(windowMock.calls.startDrag).toBe(0);
  });

  test('double-clicking the CSS drag region does not double-toggle maximize in JavaScript', async () => {
    uiStore.setPlatform('macos');
    renderTitleBar();

    await fireEvent.dblClick(screen.getByLabelText('Hermes window titlebar'), { button: 0 });

    expect(windowMock.calls.toggleMaximize).toBe(0);
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

    expect(windowMock.calls.startDrag).toBe(0);
  });

  test('pressing custom window control buttons does not start native window dragging', async () => {
    uiStore.setPlatform('windows');
    renderTitleBar();

    await fireEvent.mouseDown(screen.getByTitle('Minimize'), { button: 0 });

    expect(windowMock.calls.startDrag).toBe(0);
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
    expect(windowMock.calls.startDrag).toBe(0);
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

  test('clicking minimize/toggleMaximize/close drives the Electron window bridge', async () => {
    uiStore.setPlatform('windows');
    renderTitleBar();

    await fireEvent.click(screen.getByTitle('Minimize'));
    await fireEvent.click(screen.getByTitle('Maximize'));
    await fireEvent.click(screen.getByTitle('Close'));

    await vi.waitFor(() => {
      expect(windowMock.calls.minimize).toBe(1);
      expect(windowMock.calls.toggleMaximize).toBe(1);
      expect(windowMock.calls.close).toBe(1);
    });
    expect(windowMock.calls.startDrag).toBe(0);
  });

  test('reflects native maximize state changes and removes the state listener on cleanup', async () => {
    uiStore.setPlatform('windows');
    windowMock.currentState = { focused: true, maximized: true, minimized: false };
    const { unmount } = renderTitleBar();

    await vi.waitFor(() => {
      expect(screen.getByTitle('Restore')).toBeTruthy();
      expect(windowMock.calls.state).toBe(1);
      expect(windowMock.stateListeners).toHaveLength(1);
    });

    windowMock.stateListeners[0]?.({ focused: true, maximized: false, minimized: false });
    await vi.waitFor(() => expect(screen.getByTitle('Maximize')).toBeTruthy());

    unmount();
    expect(windowMock.stateListeners).toHaveLength(0);
  });

  test('does not let a late initial state response overwrite a newer state event', async () => {
    let resolveInitialState!: (state: NativeWindowState) => void;
    windowMock.pendingState = new Promise((resolve) => {
      resolveInitialState = resolve;
    });
    uiStore.setPlatform('windows');
    renderTitleBar();

    await vi.waitFor(() => expect(windowMock.stateListeners).toHaveLength(1));
    windowMock.stateListeners[0]?.({ focused: true, maximized: true, minimized: false });
    await vi.waitFor(() => expect(screen.getByTitle('Restore')).toBeTruthy());

    resolveInitialState({ focused: true, maximized: false, minimized: false });
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));

    expect(screen.getByTitle('Restore')).toBeTruthy();
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

  test('dragging on session title text also relies only on the CSS drag region', async () => {
    (sessionStore as any).activeSession = { title: 'Test Session' };
    uiStore.setPlatform('macos');
    renderTitleBar();

    await fireEvent.mouseDown(screen.getByText('Test Session'), { button: 0 });

    expect(windowMock.calls.startDrag).toBe(0);
  });

  test('double-clicking on the session title does not issue a second maximize', async () => {
    (sessionStore as any).activeSession = { title: 'Test Session' };
    uiStore.setPlatform('macos');
    renderTitleBar();

    await fireEvent.dblClick(screen.getByText('Test Session'), { button: 0 });

    expect(windowMock.calls.toggleMaximize).toBe(0);
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

  test('environment panel toggle is an independent titlebar icon when enabled', () => {
    const onToggleEnvironmentPanel = vi.fn();
    renderTitleBar({
      showEnvironmentToggle: true,
      environmentPanelOpen: true,
      onToggleEnvironmentPanel,
    });

    const btn = screen.getByRole('button', { name: 'Hide Environment panel' });
    expect(btn).toBeTruthy();
    expect(btn.getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(btn);

    expect(onToggleEnvironmentPanel).toHaveBeenCalledTimes(1);
    expect(sidePanelToggle).not.toHaveBeenCalled();
  });

  test('environment panel toggle is hidden outside conversation chrome', () => {
    renderTitleBar();

    expect(screen.queryByRole('button', { name: /Environment panel/ })).toBeNull();
  });

  test('tools dock toggle button moves out of the titlebar when dock is open', () => {
    sidePanelState.open = true;
    sidePanelToggle.mockReset();
    renderTitleBar();

    expect(screen.queryByRole('button', { name: 'Hide tools dock' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Show tools dock' })).toBeNull();
  });

  test('clicking tools dock toggle calls sidePanelStore toggle', () => {
    sidePanelState.open = false;
    sidePanelToggle.mockReset();
    sidePanelToggle.mockImplementation(() => {
      sidePanelState.open = !sidePanelState.open;
      if (sidePanelState.open) sidePanelState.activeView = 'menu';
    });
    renderTitleBar();

    fireEvent.click(screen.getByRole('button', { name: 'Show tools dock' }));

    expect(sidePanelToggle).toHaveBeenCalledWith();
  });

  test('clicking closed empty tools dock requests the add tool menu for the right toolbar', () => {
    sidePanelState.open = false;
    sidePanelState.openTabs = [];
    renderTitleBar();

    fireEvent.click(screen.getByRole('button', { name: 'Show tools dock' }));

    expect(sidePanelRequestToolMenuOpen).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu', { name: 'Add tool tab' })).toBeNull();
  });

  test('toggling the tools dock does not move the fixed navigation toolbar', () => {
    sidePanelState.open = false;
    sidePanelToggle.mockReset();
    sidePanelToggle.mockImplementation(() => {
      sidePanelState.open = !sidePanelState.open;
      if (sidePanelState.open) sidePanelState.activeView = 'menu';
    });
    renderTitleBar();
    const toolbar = getNavigationToolbar();

    expect(toolbar.style.left).toBe('85px');

    fireEvent.click(screen.getByRole('button', { name: 'Show tools dock' }));

    expect(sidePanelToggle).toHaveBeenCalledWith();
    expect(toolbar.style.left).toBe('85px');
  });
});
