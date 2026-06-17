import { render, screen } from '@solidjs/testing-library';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { JSX } from 'solid-js';

const { navigateMock, locationState } = vi.hoisted(() => ({
  navigateMock: vi.fn(),
  locationState: { pathname: '/conversation/session-1' },
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

import { Sidebar } from '../Sidebar.js';

describe('Sidebar navigation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    locationState.pathname = '/conversation/session-1';
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
});
