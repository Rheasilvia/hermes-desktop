import { fireEvent, render, screen } from '@solidjs/testing-library';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { JSX } from 'solid-js';

const { navigateMock, locationState, sessionState } = vi.hoisted(() => ({
  navigateMock: vi.fn(),
  locationState: { pathname: '/settings/general' },
  sessionState: {
    activeSessionId: 'session-1' as string | null,
    sessions: [{ id: 'session-1' }, { id: 'session-2' }],
    createSession: vi.fn(),
    setActiveSession: vi.fn(),
  },
}));

vi.mock('@solidjs/router', () => ({
  A: (props: { href: string; class?: string; children: JSX.Element; 'aria-current'?: 'page' }) => (
    <a href={props.href} class={props.class} aria-current={props['aria-current']}>{props.children}</a>
  ),
  useLocation: () => locationState,
  useNavigate: () => navigateMock,
}));

vi.mock('@/stores/config.js', () => ({
  configStore: {
    loadConfig: vi.fn(),
    get isLoading() { return false; },
    get config() { return {}; },
    get error() { return ''; },
  },
}));

vi.mock('@/stores/session.js', () => ({
  sessionStore: {
    get activeSessionId() { return sessionState.activeSessionId; },
    get sessions() { return sessionState.sessions; },
    createSession: sessionState.createSession,
    setActiveSession: sessionState.setActiveSession,
  },
}));

vi.mock('@/shell/ModuleLayout.js', () => ({
  ModuleLayout: (props: { title: string; description?: string; children: JSX.Element }) => (
    <section aria-label={props.title}>{props.children}</section>
  ),
}));

vi.mock('@/ui/atoms/LoadingSpinner.js', () => ({
  LoadingSpinner: () => <span>Loading</span>,
}));

vi.mock('@/features/sessions/SessionsPageContent.js', () => ({
  SessionsPageContent: () => <div>Sessions content</div>,
}));
vi.mock('@/features/model/ModelPageContent.js', () => ({
  ModelPageContent: () => <div>Model content</div>,
}));
vi.mock('@/features/skills/SkillsView.js', () => ({
  SkillsView: () => <div>Skills content</div>,
}));
vi.mock('@/features/plugins/PluginsView.js', () => ({
  PluginsView: () => <div>Plugins content</div>,
}));
vi.mock('@/features/mcp/index.js', () => ({
  McpView: () => <div>MCP content</div>,
}));
vi.mock('@/features/memory/MemoryManagerView.js', () => ({
  MemoryManagerView: () => <div>Memory files content</div>,
}));
vi.mock('@/features/gateway/GatewayView.js', () => ({
  GatewayView: () => <div>Gateway content</div>,
}));
vi.mock('@/features/cron/index.js', () => ({
  CronView: () => <div>Cron content</div>,
}));
vi.mock('../ArchivedChatsView.js', () => ({
  ArchivedChatsView: () => <div>Archived chats content</div>,
}));

vi.mock('../tabs/GeneralTab.js', () => ({ GeneralTab: () => <div>General content</div> }));
vi.mock('../tabs/AgentTab.js', () => ({ AgentTab: () => <div>Agent content</div> }));
vi.mock('../tabs/MemoryTab.js', () => ({ MemoryTab: () => <div>Memory settings content</div> }));
vi.mock('../tabs/SecurityTab.js', () => ({ SecurityTab: () => <div>Security content</div> }));
vi.mock('../tabs/VoiceTab.js', () => ({ VoiceTab: () => <div>Voice content</div> }));
vi.mock('../tabs/BrowserTab.js', () => ({ BrowserTab: () => <div>Browser content</div> }));
vi.mock('../tabs/YamlTab.js', () => ({ YamlTab: () => <div>YAML content</div> }));

import { SettingsView } from '../SettingsView.js';

describe('SettingsView navigation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    locationState.pathname = '/settings/general';
    sessionState.activeSessionId = 'session-1';
    sessionState.sessions = [{ id: 'session-1' }, { id: 'session-2' }];
    sessionState.createSession.mockReset();
    sessionState.setActiveSession.mockReset();
  });

  test('groups desktop tools and archived chats inside settings', () => {
    render(() => <SettingsView />);

    expect(screen.queryByRole('heading', { name: 'Settings' })).toBeNull();
    expect(screen.getByLabelText('Settings sidebar').getAttribute('style')).toContain('width: 240px');
    expect(screen.getByRole('searchbox', { name: /Search settings/i })).not.toBeNull();
    expect(screen.getByText('Personal')).not.toBeNull();
    expect(screen.getByText('Tools')).not.toBeNull();
    expect(screen.getByText('Archived')).not.toBeNull();
    expect(screen.getByRole('link', { name: /Sessions/i }).getAttribute('href')).toBe('/settings/sessions');
    expect(screen.getByRole('link', { name: /Memory files/i }).getAttribute('href')).toBe('/settings/memory');
    expect(screen.getByRole('link', { name: /Archived chats/i }).getAttribute('href')).toBe('/settings/archived-chats');
  });

  test('filters settings navigation from the search field', async () => {
    render(() => <SettingsView />);

    await fireEvent.input(screen.getByRole('searchbox', { name: /Search settings/i }), {
      target: { value: 'mcp' },
    });

    expect(screen.getByRole('link', { name: /MCP servers/i })).not.toBeNull();
    expect(screen.queryByRole('link', { name: /General/i })).toBeNull();
  });

  test('marks the URL-driven settings section as active', () => {
    locationState.pathname = '/settings/model';

    render(() => <SettingsView />);

    expect(screen.getByRole('link', { name: /Model/i }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('link', { name: /General/i }).getAttribute('aria-current')).toBeNull();
  });

  test('back to app returns to the active session and hides settings shell on route change', async () => {
    render(() => <SettingsView />);

    await fireEvent.click(screen.getByRole('button', { name: /Back to App/i }));

    expect(sessionState.setActiveSession).toHaveBeenCalledWith('session-1');
    expect(navigateMock).toHaveBeenCalledWith('/conversation/session-1');
  });

  test('back to app creates a conversation when no session exists', async () => {
    sessionState.activeSessionId = null;
    sessionState.sessions = [];
    sessionState.createSession.mockResolvedValueOnce({ id: 'new-session' });

    render(() => <SettingsView />);

    await fireEvent.click(screen.getByRole('button', { name: /Back to App/i }));

    expect(sessionState.createSession).toHaveBeenCalledWith({});
    expect(navigateMock).toHaveBeenCalledWith('/conversation/new-session');
  });

  test('redirects bare settings route to general section', () => {
    locationState.pathname = '/settings';

    render(() => <SettingsView />);

    expect(navigateMock).toHaveBeenCalledWith('/settings/general', { replace: true });
  });
});
