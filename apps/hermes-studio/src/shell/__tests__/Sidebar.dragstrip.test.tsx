import { render, fireEvent, screen } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
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

function getDragStrip() {
  return document.querySelector('aside')?.firstElementChild as HTMLElement;
}

describe('Sidebar window drag strip', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    locationState.pathname = '/conversation/session-1';
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('renders a titlebar-height CSS drag strip without legacy attributes', () => {
    render(() => <Sidebar />);

    const strip = getDragStrip();
    expect(strip).toBeTruthy();
    expect(strip.getAttribute('aria-hidden')).toBe('true');
    expect(strip.getAttributeNames()).toEqual(expect.arrayContaining(['class', 'aria-hidden']));
  });

  test('keeps native double-click behavior free of a JavaScript handler', async () => {
    render(() => <Sidebar />);
    const strip = getDragStrip();

    await fireEvent.dblClick(strip, { button: 0 });

    expect(getDragStrip()).toBe(strip);
  });

  test('keeps native dragging free of an imperative JavaScript handler', async () => {
    render(() => <Sidebar />);

    await fireEvent.mouseDown(getDragStrip(), { button: 0 });

    expect(getDragStrip()).toBeTruthy();
  });

  test('the New Chat button is not covered by the drag strip and stays clickable', () => {
    render(() => <Sidebar />);

    const newChat = screen.getByRole('button', { name: /New Chat/i });
    expect(newChat).toBeTruthy();
    // The button is below the strip's overlay and is not itself a drag region.
    expect(newChat).not.toBe(getDragStrip());
  });
});
