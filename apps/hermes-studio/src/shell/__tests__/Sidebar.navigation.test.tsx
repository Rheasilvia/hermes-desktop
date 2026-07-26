import { fireEvent, render, screen } from '@solidjs/testing-library';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { JSX } from 'solid-js';

const { navigateMock, locationState, sessionState } = vi.hoisted(() => ({
  navigateMock: vi.fn(),
  locationState: { pathname: '/conversation/session-1' },
  sessionState: {
    sessions: [] as Array<{ id: string; title: string; cwd?: string | null }>,
  },
}));

vi.mock('@solidjs/router', () => ({
  A: (props: JSX.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; children: JSX.Element }) => {
    const { children, ...rest } = props;
    return <a {...rest}>{children}</a>;
  },
  useLocation: () => locationState,
  useNavigate: () => navigateMock,
}));

vi.mock('@/stores/session.js', () => ({
  sessionStore: {
    get sessions() { return sessionState.sessions; },
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

vi.mock('@/ui/atoms/Input.js', () => ({
  Input: (props: JSX.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}));

vi.mock('@/ui/atoms/Button.js', () => ({
  Button: (props: JSX.ButtonHTMLAttributes<HTMLButtonElement> & { children: JSX.Element }) => (
    <button {...props} type={props.type ?? 'button'}>{props.children}</button>
  ),
}));

vi.mock('@/version', () => ({
  APP_VERSION: '0.0.0-test',
  APP_COMMIT: 'test',
}));

import { Sidebar } from '../Sidebar.js';

describe('Sidebar navigation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    locationState.pathname = '/conversation/session-1';
    sessionState.sessions = [];
  });

  test('does not render the old tools group in the primary sidebar', () => {
    render(() => <Sidebar />);

    expect(screen.queryByText('Tools')).toBeNull();
    expect(screen.queryByRole('link', { name: /Sessions/i })).toBeNull();
    const settings = screen.getByRole('link', { name: /Settings/i });
    expect(settings.getAttribute('href')).toBe('/settings/general');
  });

  test('marks settings active through the shared sidebar nav', () => {
    locationState.pathname = '/settings/general';

    render(() => <Sidebar />);

    expect(screen.getByRole('link', { name: /Settings/i }).getAttribute('aria-current')).toBe('page');
  });

  test('renders the session context menu through a body-level portal', () => {
    sessionState.sessions = [{ id: 'session-1', title: 'Layer Test', cwd: '/repo' }];
    render(() => <Sidebar />);

    const sidebar = document.querySelector('aside');
    fireEvent.contextMenu(screen.getByRole('link', { name: /Layer Test/i }), {
      clientX: 64,
      clientY: 96,
    });

    const menu = document.querySelector('[data-context-menu]') as HTMLElement;
    expect(menu).toBeTruthy();
    expect(document.body.contains(menu)).toBe(true);
    expect(sidebar?.contains(menu)).toBe(false);
    expect(screen.getByRole('button', { name: /Rename/i })).toBeDefined();
  });

  test('clamps the session context menu to the viewport edge', () => {
    sessionState.sessions = [{ id: 'session-1', title: 'Layer Test', cwd: '/repo' }];
    vi.stubGlobal('innerWidth', 300);
    vi.stubGlobal('innerHeight', 220);

    try {
      render(() => <Sidebar />);
      fireEvent.contextMenu(screen.getByRole('link', { name: /Layer Test/i }), {
        clientX: 290,
        clientY: 215,
      });

      const menu = document.querySelector('[data-context-menu]') as HTMLElement;
      expect(menu.style.left).toBe('144px');
      expect(menu.style.top).toBe('22px');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  test('opens rename dialog outside the sidebar after choosing Rename from the context menu', () => {
    sessionState.sessions = [{ id: 'session-1', title: 'Layer Test', cwd: '/repo' }];
    render(() => <Sidebar />);

    const sidebar = document.querySelector('aside');
    fireEvent.contextMenu(screen.getByRole('link', { name: /Layer Test/i }), {
      clientX: 64,
      clientY: 96,
    });
    fireEvent.click(screen.getByRole('button', { name: /Rename/i }));

    const dialog = screen.getByRole('dialog');
    expect(document.body.contains(dialog)).toBe(true);
    expect(sidebar?.contains(dialog)).toBe(false);
    expect(screen.getByText('Rename conversation')).toBeDefined();
  });
});
