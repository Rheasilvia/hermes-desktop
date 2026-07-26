import { render, fireEvent, screen } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { JSX } from 'solid-js';

// Counter bag hoisted so the vi.mock factory can read it. We assert these stay
// at 0 to prove the sidebar drag strip does NOT double-toggle maximize via JS
// (the native data-tauri-drag-region script owns drag + double-click-maximize).
const windowMock = vi.hoisted(() => ({
  calls: { startDragging: 0, toggleMaximize: 0 },
}));

const { navigateMock, locationState } = vi.hoisted(() => ({
  navigateMock: vi.fn(),
  locationState: { pathname: '/conversation/session-1' },
}));

vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => true,
  invoke: async () => 'macos',
}));

vi.mock('@solidjs/router', () => ({
  A: (props: { href: string; class?: string; title?: string; children: JSX.Element; 'aria-current'?: 'page' }) => (
    <a href={props.href} class={props.class} title={props.title} aria-current={props['aria-current']}>{props.children}</a>
  ),
  useLocation: () => locationState,
  useNavigate: () => navigateMock,
}));

vi.mock('@/stores/session.js', () => ({
  sessionStore: {
    get sessions() { return []; },
    createSession: vi.fn(),
    deleteSession: vi.fn(),
    renameSession: vi.fn(),
    archiveSession: vi.fn(),
  },
}));

vi.mock('@/stores/chat.js', () => ({
  chatStore: {
    isStreaming: () => false,
  },
}));

vi.mock('@/stores/ui.js', () => ({
  uiStore: {
    sidebarWidth: 280,
    pinnedSessionIds: [],
    workspaceGrouping: false,
    pinnedSectionOpen: true,
    conversationsSectionOpen: true,
    setSidebarWidth: vi.fn(),
    isPinned: () => false,
    pinSession: vi.fn(),
    unpinSession: vi.fn(),
    togglePinnedSection: vi.fn(),
    toggleConversationsSection: vi.fn(),
    toggleWorkspaceGrouping: vi.fn(),
  },
}));

vi.mock('@/ui/molecules/Modal.js', () => ({
  Modal: () => null,
}));

vi.mock('@/ui/atoms/Input.js', () => ({
  Input: () => <input />,
}));

vi.mock('@/ui/atoms/Button.js', () => ({
  Button: (props: { children: JSX.Element }) => <button type="button">{props.children}</button>,
}));

vi.mock('@/version', () => ({
  APP_VERSION: '0.0.0-test',
  APP_COMMIT: 'test',
}));

// Stub Tauri internals so any window IPC is observable. We assert the drag
// strip never issues startDragging or toggleMaximize via JS — both are owned
// by the native data-tauri-drag-region built-in script, and a JS
// toggleMaximize() on dblclick would double-toggle against the native one
// (maximize then restore = "snaps back").
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
});

// Import AFTER mocks are registered.
import { Sidebar } from '../Sidebar.js';

function getDragStrip() {
  // The drag strip is the only aria-hidden="true" element carrying the
  // tauri drag-region attribute inside the sidebar.
  return document.querySelector('[data-tauri-drag-region][aria-hidden="true"]') as HTMLElement;
}

describe('Sidebar window drag strip', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    windowMock.calls.startDragging = 0;
    windowMock.calls.toggleMaximize = 0;
    locationState.pathname = '/conversation/session-1';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('renders a titlebar-height drag strip carrying the native tauri drag-region attribute', () => {
    render(() => <Sidebar />);

    const strip = getDragStrip();
    expect(strip).toBeTruthy();
    expect(strip.hasAttribute('data-tauri-drag-region')).toBe(true);
    expect(strip.getAttribute('aria-hidden')).toBe('true');
  });

  test('does not bind a JS dblclick handler (native drag-region owns maximize)', async () => {
    // Tauri's built-in data-tauri-drag-region script handles double-click →
    // maximize natively. A JS onDblClick → toggleMaximize() would double-toggle
    // against it (maximize then restore). So a dblclick must NOT issue a JS
    // toggleMaximize IPC.
    render(() => <Sidebar />);

    await fireEvent.dblClick(getDragStrip(), { button: 0 });

    // Let any pending microtasks flush before asserting nothing fired.
    await new Promise((r) => setTimeout(r, 0));
    expect(windowMock.calls.toggleMaximize).toBe(0);
    expect(windowMock.calls.startDragging).toBe(0);
  });

  test('mousedown does not issue a JS startDragging (native drag-region owns drag)', async () => {
    render(() => <Sidebar />);

    await fireEvent.mouseDown(getDragStrip(), { button: 0 });

    await new Promise((r) => setTimeout(r, 0));
    expect(windowMock.calls.startDragging).toBe(0);
  });

  test('the New Chat button is not covered by the drag strip and stays clickable', () => {
    render(() => <Sidebar />);

    const newChat = screen.getByRole('button', { name: /New Chat/i });
    expect(newChat).toBeTruthy();
    // The button is below the strip's overlay and is not itself a drag region.
    expect(newChat.hasAttribute('data-tauri-drag-region')).toBe(false);
  });
});
