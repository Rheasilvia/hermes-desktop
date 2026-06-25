import { render, fireEvent, screen, waitFor } from '@solidjs/testing-library';
import { createRoot, createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

interface MockToolTab {
  id: string;
  kind: 'review' | 'terminal' | 'files' | 'delegation';
  title: string;
  cwd: string | null;
}

const windowMock = vi.hoisted(() => ({
  calls: { startDragging: 0, toggleMaximize: 0 },
}));

const {
  sidePanelState,
  sidePanelToggle,
  sidePanelOpenTab,
  sidePanelSetActiveTab,
  sidePanelSetActiveView,
  sidePanelCloseTab,
  sidePanelRenameTab,
  sidePanelClearToolMenuOpenRequest,
} = vi.hoisted(() => {
  type MockKind = 'review' | 'terminal' | 'files' | 'delegation';
  type MockTab = { id: string; kind: MockKind; title: string; cwd: string | null };
  const toolTitles: Record<MockKind, string> = {
    review: 'Review',
    terminal: 'Terminal',
    files: 'Open file',
    delegation: 'Delegation',
  };
  let nextTerminal = 1;
  const uniqueTerminalTitle = (tabs: MockTab[], base: string) => {
    const existing = new Set(tabs.filter((tab) => tab.kind === 'terminal').map((tab) => tab.title));
    if (!existing.has(base)) return base;
    let suffix = 2;
    let candidate = `${base} ${suffix}`;
    while (existing.has(candidate)) {
      suffix += 1;
      candidate = `${base} ${suffix}`;
    }
    return candidate;
  };
  const state = {
    _open: false,
    _activeTabId: null as string | null,
    _openTabs: [] as MockTab[],
    _toolMenuOpenRequested: false,
    _readOpen: undefined as undefined | (() => boolean),
    _writeOpen: undefined as undefined | ((open: boolean) => void),
    _readActiveTabId: undefined as undefined | (() => string | null),
    _writeActiveTabId: undefined as undefined | ((id: string | null) => void),
    _readOpenTabs: undefined as undefined | (() => MockTab[]),
    _writeOpenTabs: undefined as undefined | ((tabs: MockTab[]) => void),
    _readToolMenuOpenRequested: undefined as undefined | (() => boolean),
    _writeToolMenuOpenRequested: undefined as undefined | ((requested: boolean) => void),
    get open() {
      return this._open;
    },
    set open(open: boolean) {
      this._open = open;
      this._writeOpen?.(open);
    },
    get activeTabId() {
      return this._activeTabId;
    },
    set activeTabId(id: string | null) {
      this._activeTabId = id;
      this._writeActiveTabId?.(id);
    },
    get activeView() {
      return this.openTabs.find((tab) => tab.id === this.activeTabId)?.kind ?? 'menu';
    },
    set activeView(view: string) {
      if (view === 'menu') {
        this.activeTabId = null;
        return;
      }
      const existing = this.openTabs.find((tab) => tab.kind === view);
      if (existing) {
        this.activeTabId = existing.id;
      }
    },
    get openTabs() {
      return this._openTabs;
    },
    set openTabs(tabs: MockTab[]) {
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
    readActiveTabId() {
      return this._readActiveTabId?.() ?? this._activeTabId;
    },
    readActiveView() {
      const id = this.readActiveTabId();
      return this.readOpenTabs().find((tab) => tab.id === id)?.kind ?? 'menu';
    },
    readOpenTabs() {
      return this._readOpenTabs?.() ?? this._openTabs;
    },
    readToolMenuOpenRequested() {
      return this._readToolMenuOpenRequested?.() ?? this._toolMenuOpenRequested;
    },
    resetTerminalCounter() {
      nextTerminal = 1;
    },
    makeTab(kind: MockKind, title?: string, id?: string, cwd: string | null = null): MockTab {
      return {
        id: id ?? (kind === 'terminal' ? `terminal-${nextTerminal++}` : `tool-${kind}`),
        kind,
        title: title ?? toolTitles[kind],
        cwd,
      };
    },
    makeOpenedTab(kind: MockKind, options?: { title?: string | null; cwd?: string | null }): MockTab {
      if (kind === 'terminal') {
        const title = uniqueTerminalTitle(this.openTabs, options?.title?.trim() || 'Terminal');
        return this.makeTab('terminal', title, undefined, options?.cwd ?? null);
      }
      return this.makeTab(kind);
    },
  };
  return {
    sidePanelState: state,
    sidePanelToggle: vi.fn(() => {
      state.open = !state.open;
      if (state.open && state.openTabs.length > 0 && !state.activeTabId) {
        state.activeTabId = state.openTabs[0]!.id;
      }
    }),
    sidePanelOpenTab: vi.fn((view: MockKind, options?: { title?: string | null; cwd?: string | null }) => {
      if (view === 'terminal') {
        const tab = state.makeOpenedTab(view, options);
        state.openTabs = [...state.openTabs, tab];
        state.activeTabId = tab.id;
        state.open = true;
        return tab;
      }
      const existing = state.openTabs.find((tab) => tab.kind === view);
      if (existing) {
        state.activeTabId = existing.id;
        state.open = true;
        return existing;
      }
      const tab = state.makeOpenedTab(view);
      state.openTabs = [...state.openTabs, tab];
      state.activeTabId = tab.id;
      state.open = true;
      return tab;
    }),
    sidePanelSetActiveTab: vi.fn((id: string) => {
      if (state.openTabs.some((tab) => tab.id === id)) {
        state.activeTabId = id;
      }
    }),
    sidePanelSetActiveView: vi.fn((view: string) => {
      state.activeView = view;
    }),
    sidePanelCloseTab: vi.fn((id: string) => {
      const previous = state.openTabs;
      const index = previous.findIndex((tab) => tab.id === id);
      const next = previous.filter((tab) => tab.id !== id);
      state.openTabs = next;
      if (state.activeTabId === id) {
        state.activeTabId = next[index]?.id ?? next[index - 1]?.id ?? null;
      }
      if (next.length === 0) {
        state.open = false;
      }
    }),
    sidePanelRenameTab: vi.fn((id: string, title: string) => {
      const trimmed = title.trim();
      if (!trimmed) return;
      state.openTabs = state.openTabs.map((tab) => (
        tab.id === id ? { ...tab, title: trimmed } : tab
      ));
    }),
    sidePanelClearToolMenuOpenRequest: vi.fn(() => {
      state.toolMenuOpenRequested = false;
    }),
  };
});

vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => true,
  invoke: async () => 'macos',
}));

vi.mock('@/stores/side-panel.js', () => ({
  sidePanelStore: {
    isOpen: () => sidePanelState.readOpen(),
    activeView: () => sidePanelState.readActiveView(),
    activeTabId: () => sidePanelState.readActiveTabId(),
    openTabs: () => sidePanelState.readOpenTabs(),
    toolMenuOpenRequested: () => sidePanelState.readToolMenuOpenRequested(),
    toggle: sidePanelToggle,
    openTab: sidePanelOpenTab,
    setActiveTab: sidePanelSetActiveTab,
    setActiveView: sidePanelSetActiveView,
    closeTab: sidePanelCloseTab,
    renameTab: sidePanelRenameTab,
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
    const [activeTabId, setActiveTabId] = createSignal(sidePanelState.activeTabId);
    const [openTabs, setOpenTabs] = createSignal(sidePanelState.openTabs);
    const [toolMenuOpenRequested, setToolMenuOpenRequested] = createSignal(sidePanelState.toolMenuOpenRequested);
    sidePanelState._readOpen = open;
    sidePanelState._writeOpen = setOpen;
    sidePanelState._readActiveTabId = activeTabId;
    sidePanelState._writeActiveTabId = setActiveTabId;
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
    sidePanelState.activeTabId = null;
    sidePanelState.openTabs = [];
    sidePanelState.toolMenuOpenRequested = false;
    sidePanelState.resetTerminalCounter();
    windowMock.calls.startDragging = 0;
    windowMock.calls.toggleMaximize = 0;
    installSidePanelSignals();
    sidePanelToggle.mockClear();
    sidePanelOpenTab.mockClear();
    sidePanelSetActiveTab.mockClear();
    sidePanelSetActiveView.mockClear();
    sidePanelCloseTab.mockClear();
    sidePanelRenameTab.mockClear();
    sidePanelClearToolMenuOpenRequest.mockClear();
  });

  afterEach(() => {
    disposeSidePanelSignals?.();
    disposeSidePanelSignals = undefined;
    vi.clearAllMocks();
  });

  test('renders tool tab instances inside the right dock toolbar when the dock is open', () => {
    const terminal = sidePanelState.makeTab('terminal', 'PreDoc', 'terminal-1', '/repo/PreDoc');
    const files = sidePanelState.makeTab('files');
    sidePanelState.open = true;
    sidePanelState.openTabs = [terminal, files];
    sidePanelState.activeTabId = terminal.id;

    render(() => <ToolDockToolbar />);

    expect(screen.getByRole('toolbar', { name: 'Tool dock toolbar' })).toBeTruthy();
    expect(screen.getByRole('tablist', { name: 'Tool tabs' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'PreDoc' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tab', { name: 'Open file' }).getAttribute('aria-selected')).toBe('false');
    expect(screen.getByRole('button', { name: 'Add tool tab' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Hide tools dock' })).toBeTruthy();
  });

  test('right dock toolbar supports native drag and double-click maximize from empty title space', async () => {
    sidePanelState.open = true;
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
    const terminal = sidePanelState.makeTab('terminal', 'PreDoc', 'terminal-1');
    sidePanelState.open = true;
    sidePanelState.openTabs = [terminal];
    sidePanelState.activeTabId = terminal.id;

    render(() => <ToolDockToolbar />);

    await fireEvent.mouseDown(screen.getByRole('tab', { name: 'PreDoc' }), { button: 0 });
    await fireEvent.dblClick(screen.getByRole('tab', { name: 'PreDoc' }), { button: 0 });
    await fireEvent.mouseDown(screen.getByRole('button', { name: 'Add tool tab' }), { button: 0 });
    await fireEvent.dblClick(screen.getByRole('button', { name: 'Add tool tab' }), { button: 0 });

    expect(windowMock.calls.startDragging).toBe(0);
    expect(windowMock.calls.toggleMaximize).toBe(0);
  });

  test('plus menu creates multiple terminal tabs and keeps non-terminal tools singleton', () => {
    const terminal = sidePanelState.makeTab('terminal', 'PreDoc', 'terminal-1', '/repo/PreDoc');
    sidePanelState.open = true;
    sidePanelState.openTabs = [terminal];
    sidePanelState.activeTabId = terminal.id;

    render(() => <ToolDockToolbar terminalCwd="/repo/PreDoc" terminalTitle="PreDoc" />);

    fireEvent.click(screen.getByRole('button', { name: 'Add tool tab' }));
    expect(screen.getByRole('menuitem', { name: /Review/ })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: /Terminal/ })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: /Open file/ })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: /Delegation/ })).toBeTruthy();

    fireEvent.click(screen.getByRole('menuitem', { name: /Terminal/ }));
    expect(sidePanelState.openTabs.map((tab) => tab.title)).toEqual(['PreDoc', 'PreDoc 2']);
    expect(sidePanelState.openTabs.map((tab) => tab.kind)).toEqual(['terminal', 'terminal']);
    expect(sidePanelOpenTab).toHaveBeenLastCalledWith('terminal', { cwd: '/repo/PreDoc', title: 'PreDoc' });

    fireEvent.click(screen.getByRole('button', { name: 'Add tool tab' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Open file/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Add tool tab' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Open file/ }));

    expect(sidePanelState.openTabs.map((tab) => tab.kind)).toEqual(['terminal', 'terminal', 'files']);
    expect(sidePanelState.activeView).toBe('files');
  });

  test('renames terminal tabs inline with Enter and cancels with Escape', async () => {
    const terminal = sidePanelState.makeTab('terminal', 'PreDoc', 'terminal-1');
    sidePanelState.open = true;
    sidePanelState.openTabs = [terminal];
    sidePanelState.activeTabId = terminal.id;

    render(() => <ToolDockToolbar />);

    await fireEvent.dblClick(screen.getByRole('tab', { name: 'PreDoc' }));
    const renameInput = screen.getByRole('textbox', { name: 'Rename PreDoc tab' }) as HTMLInputElement;
    fireEvent.input(renameInput, { target: { value: 'Build Shell' } });
    await fireEvent.keyDown(renameInput, { key: 'Enter' });

    expect(sidePanelRenameTab).toHaveBeenCalledWith('terminal-1', 'Build Shell');
    expect(screen.getByRole('tab', { name: 'Build Shell' })).toBeTruthy();

    await fireEvent.dblClick(screen.getByRole('tab', { name: 'Build Shell' }));
    const cancelInput = screen.getByRole('textbox', { name: 'Rename Build Shell tab' }) as HTMLInputElement;
    fireEvent.input(cancelInput, { target: { value: 'Discarded' } });
    await fireEvent.keyDown(cancelInput, { key: 'Escape' });

    expect(sidePanelState.openTabs[0]?.title).toBe('Build Shell');
    expect(screen.queryByRole('textbox')).toBeNull();
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

  test('clicking a tab close button calls closeTab with the tab id without selecting it', () => {
    const terminal = sidePanelState.makeTab('terminal', 'PreDoc', 'terminal-1');
    const files = sidePanelState.makeTab('files');
    sidePanelState.open = true;
    sidePanelState.openTabs = [terminal, files];
    sidePanelState.activeTabId = terminal.id;

    render(() => <ToolDockToolbar />);

    fireEvent.click(screen.getByRole('button', { name: 'Close PreDoc tab' }));

    expect(sidePanelCloseTab).toHaveBeenCalledWith('terminal-1');
    expect(sidePanelSetActiveTab).not.toHaveBeenCalled();
    expect(sidePanelSetActiveView).not.toHaveBeenCalled();
  });

  test('closing the last open tab collapses the dock', () => {
    const terminal = sidePanelState.makeTab('terminal', 'PreDoc', 'terminal-1');
    sidePanelState.open = true;
    sidePanelState.openTabs = [terminal];
    sidePanelState.activeTabId = terminal.id;

    render(() => <ToolDockToolbar />);

    fireEvent.click(screen.getByRole('button', { name: 'Close PreDoc tab' }));

    expect(sidePanelCloseTab).toHaveBeenCalledWith('terminal-1');
    expect(sidePanelState.openTabs).toEqual([]);
    expect(sidePanelState.open).toBe(false);
  });
});
