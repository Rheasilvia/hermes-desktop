import { render, fireEvent, screen } from '@solidjs/testing-library';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const { navigateMock, locationState } = vi.hoisted(() => ({
  navigateMock: vi.fn(),
  locationState: { pathname: '/conversation/test-session' },
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
  }) => (
    <header>
      <button type="button" onClick={props.onToggleSidebar}>Toggle Sidebar</button>
      <button type="button" onClick={props.onNavigateBack}>Back</button>
      <button type="button" onClick={props.onNavigateForward}>Forward</button>
    </header>
  ),
}));

vi.mock('@/shell/CommandPalette', () => ({
  CommandPalette: () => null,
  buildDefaultActions: () => [],
}));

vi.mock('@/stores/session.js', () => ({
  sessionStore: {
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

describe('AppLayout sidebar titlebar controls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    locationState.pathname = '/conversation/test-session';
    uiStore.setSidebarCollapsed(false);
  });

  test('titlebar toggle hides and restores the sidebar', async () => {
    render(() => <AppLayout><div>Conversation</div></AppLayout>);

    expect(screen.queryByLabelText('Primary sidebar')).not.toBeNull();

    await fireEvent.click(screen.getByRole('button', { name: 'Toggle Sidebar' }));
    expect(screen.queryByLabelText('Primary sidebar')).toBeNull();

    await fireEvent.click(screen.getByRole('button', { name: 'Toggle Sidebar' }));
    expect(screen.queryByLabelText('Primary sidebar')).not.toBeNull();
  });

  test('settings routes hide the primary app sidebar', () => {
    locationState.pathname = '/settings/general';

    render(() => <AppLayout><div>Settings</div></AppLayout>);

    expect(screen.queryByLabelText('Primary sidebar')).toBeNull();
    expect(screen.getByText('Settings')).not.toBeNull();
  });

  test('titlebar back and forward buttons use router history deltas', async () => {
    render(() => <AppLayout><div>Conversation</div></AppLayout>);

    await fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Forward' }));

    expect(navigateMock).toHaveBeenCalledWith(-1);
    expect(navigateMock).toHaveBeenCalledWith(1);
  });
});
