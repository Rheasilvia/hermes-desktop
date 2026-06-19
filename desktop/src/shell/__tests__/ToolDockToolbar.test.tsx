import { render, fireEvent, screen, waitFor } from '@solidjs/testing-library';
import { createRoot, createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const windowMock = vi.hoisted(() => ({
  calls: { startDragging: 0, toggleMaximize: 0 },
}));

const {
  sidePanelState,
  sidePanelToggle,
  sidePanelOpenTab,
  sidePanelSetActiveView,
  sidePanelCloseTab,
  sidePanelClearToolMenuOpenRequest,
} = vi.hoisted(() => ({
  sidePanelState: {
    _open: false,
    _activeView: 'menu',
    _openTabs: [] as string[],
    _toolMenuOpenRequested: false,
    _readOpen: undefined as undefined | (() => boolean),
    _writeOpen: undefined as undefined | ((open: boolean) => void),
    _readActiveView: undefined as undefined | (() => string),
    _writeActiveView: undefined as undefined | ((view: string) => void),
    _readOpenTabs: undefined as undefined | (() => string[]),
    _writeOpenTabs: undefined as undefined | ((tabs: string[]) => void),
    _readToolMenuOpenRequested: undefined as undefined | (() => boolean),
    _writeToolMenuOpenRequested: undefined as undefined | ((requested: boolean) => void),
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
    get toolMenuOpenRequested() {
      return this._toolMenuOpenRequested;
    },
    set toolMenuOpenRequested(requested: boolean) {
      this._toolMenuOpenRequested = requested;
      this._writeToolMenuOpenRequested?.(requested);
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
    readToolMenuOpenRequested() {
      return this._readToolMenuOpenRequested?.() ?? this._toolMenuOpenRequested;
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
      sidePanelState.openTabs = [...sidePanelState.openTabs, view];
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
  sidePanelClearToolMenuOpenRequest: vi.fn(() => {
    sidePanelState.toolMenuOpenRequested = false;
  }),
}));

vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => true,
  invoke: async () => 'macos',
}));

vi.mock('@/stores/side-panel.js', () => ({
  sidePanelStore: {
    isOpen: () => sidePanelState.readOpen(),
    activeView: () => sidePanelState.readActiveView(),
    openTabs: () => sidePanelState.readOpenTabs(),
    toolMenuOpenRequested: () => sidePanelState.readToolMenuOpenRequested(),
    toggle: sidePanelToggle,
    openTab: sidePanelOpenTab,
    setActiveView: sidePanelSetActiveView,
    closeTab: sidePanelCloseTab,
    clearToolMenuOpenRequest: sidePanelClearToolMenuOpenRequest,
  },
}));

import { ToolDockToolbar } from '../ToolDockToolbar.js';

let disposeSidePanelSignals: (() => void) | undefined;

function installSidePanelSignals() {
  disposeSidePanelSignals?.();
  createRoot((dispose) => {
    disposeSidePanelSignals = dispose;
    const [open, setOpen] = createSignal(sidePanelState.open);
    const [activeView, setActiveView] = createSignal(sidePanelState.activeView);
    const [openTabs, setOpenTabs] = createSignal(sidePanelState.openTabs);
    const [toolMenuOpenRequested, setToolMenuOpenRequested] = createSignal(sidePanelState.toolMenuOpenRequested);
    sidePanelState._readOpen = open;
    sidePanelState._writeOpen = setOpen;
    sidePanelState._readActiveView = activeView;
    sidePanelState._writeActiveView = setActiveView;
    sidePanelState._readOpenTabs = openTabs;
    sidePanelState._writeOpenTabs = setOpenTabs;
    sidePanelState._readToolMenuOpenRequested = toolMenuOpenRequested;
    sidePanelState._writeToolMenuOpenRequested = setToolMenuOpenRequested;
  });
}

describe('ToolDockToolbar', () => {
  beforeEach(() => {
    (globalThis as any).__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: 'main' } },
      invoke: async (cmd: string) => {
        switch (cmd) {
          case 'plugin:window|start_dragging': { windowMock.calls.startDragging += 1; return null; }
          case 'plugin:window|toggle_maximize': { windowMock.calls.toggleMaximize += 1; return null; }
          default: return null;
        }
      },
      transformCallback: () => 0,
      convertFileSrc: (p: string) => p,
      unregisterCallback: () => {},
    };
    sidePanelState.open = false;
    sidePanelState.activeView = 'menu';
    sidePanelState.openTabs = [];
    sidePanelState.toolMenuOpenRequested = false;
    windowMock.calls.startDragging = 0;
    windowMock.calls.toggleMaximize = 0;
    installSidePanelSignals();
    sidePanelToggle.mockClear();
    sidePanelOpenTab.mockClear();
    sidePanelSetActiveView.mockClear();
    sidePanelCloseTab.mockClear();
    sidePanelClearToolMenuOpenRequest.mockClear();
  });

  afterEach(() => {
    disposeSidePanelSignals?.();
    disposeSidePanelSignals = undefined;
    vi.clearAllMocks();
  });

  test('renders tool tabs inside the right dock toolbar when the dock is open', () => {
    sidePanelState.open = true;
    sidePanelState.activeView = 'terminal';
    sidePanelState.openTabs = ['terminal', 'files'];

    render(() => <ToolDockToolbar />);

    expect(screen.getByRole('toolbar', { name: 'Tool dock toolbar' })).toBeTruthy();
    expect(screen.getByRole('tablist', { name: 'Tool tabs' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Terminal' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tab', { name: 'Open file' }).getAttribute('aria-selected')).toBe('false');
    expect(screen.getByRole('button', { name: 'Add tool tab' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Hide tools dock' })).toBeTruthy();
  });

  test('right dock toolbar supports native drag and double-click maximize from empty title space', async () => {
    sidePanelState.open = true;
    sidePanelState.activeView = 'terminal';
    sidePanelState.openTabs = ['terminal'];

    render(() => <ToolDockToolbar />);

    const toolbar = screen.getByRole('toolbar', { name: 'Tool dock toolbar' });
    expect(toolbar.hasAttribute('data-tauri-drag-region')).toBe(true);

    await fireEvent.mouseDown(toolbar, { button: 0 });
    await waitFor(() => {
      expect(windowMock.calls.startDragging).toBe(1);
    });

    await fireEvent.dblClick(toolbar, { button: 0 });
    await waitFor(() => {
      expect(windowMock.calls.toggleMaximize).toBe(1);
    });
  });

  test('right dock toolbar controls do not trigger native drag or maximize', async () => {
    sidePanelState.open = true;
    sidePanelState.activeView = 'terminal';
    sidePanelState.openTabs = ['terminal'];

    render(() => <ToolDockToolbar />);

    await fireEvent.mouseDown(screen.getByRole('tab', { name: 'Terminal' }), { button: 0 });
    await fireEvent.dblClick(screen.getByRole('tab', { name: 'Terminal' }), { button: 0 });
    await fireEvent.mouseDown(screen.getByRole('button', { name: 'Add tool tab' }), { button: 0 });
    await fireEvent.dblClick(screen.getByRole('button', { name: 'Add tool tab' }), { button: 0 });

    expect(windowMock.calls.startDragging).toBe(0);
    expect(windowMock.calls.toggleMaximize).toBe(0);
  });

  test('plus menu creates or activates tool tabs', () => {
    sidePanelState.open = true;
    sidePanelState.activeView = 'terminal';
    sidePanelState.openTabs = ['terminal'];

    render(() => <ToolDockToolbar />);

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

  test('Escape and outside pointer clicks dismiss the add tool menu', () => {
    sidePanelState.open = true;
    render(() => <ToolDockToolbar />);

    fireEvent.click(screen.getByRole('button', { name: 'Add tool tab' }));
    expect(screen.getByRole('menu', { name: 'Add tool tab' })).toBeTruthy();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu', { name: 'Add tool tab' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Add tool tab' }));
    expect(screen.getByRole('menu', { name: 'Add tool tab' })).toBeTruthy();

    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('menu', { name: 'Add tool tab' })).toBeNull();
  });

  test('opens the add tool menu when the titlebar requested it for an empty dock', () => {
    sidePanelState.open = true;
    sidePanelState.openTabs = [];
    sidePanelState.toolMenuOpenRequested = true;

    render(() => <ToolDockToolbar />);

    expect(screen.getByRole('menu', { name: 'Add tool tab' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: /Terminal/ })).toBeTruthy();
    expect(sidePanelClearToolMenuOpenRequest).toHaveBeenCalledTimes(1);
    expect(sidePanelState.toolMenuOpenRequested).toBe(false);
  });

  test('the toolbar dock toggle hides the open dock', () => {
    sidePanelState.open = true;

    render(() => <ToolDockToolbar />);

    fireEvent.click(screen.getByRole('button', { name: 'Hide tools dock' }));

    expect(sidePanelToggle).toHaveBeenCalledWith();
    expect(sidePanelState.open).toBe(false);
  });

  test('clicking a tab close button calls closeTab without selecting the tab', () => {
    sidePanelState.open = true;
    sidePanelState.activeView = 'terminal';
    sidePanelState.openTabs = ['terminal', 'files'];

    render(() => <ToolDockToolbar />);

    fireEvent.click(screen.getByRole('button', { name: 'Close Terminal tab' }));

    expect(sidePanelCloseTab).toHaveBeenCalledWith('terminal');
    expect(sidePanelSetActiveView).not.toHaveBeenCalled();
  });

  test('closing the last open tab collapses the dock', () => {
    sidePanelState.open = true;
    sidePanelState.activeView = 'terminal';
    sidePanelState.openTabs = ['terminal'];

    render(() => <ToolDockToolbar />);

    fireEvent.click(screen.getByRole('button', { name: 'Close Terminal tab' }));

    expect(sidePanelCloseTab).toHaveBeenCalledWith('terminal');
    expect(sidePanelState.openTabs).toEqual([]);
    expect(sidePanelState.open).toBe(false);
  });
});
