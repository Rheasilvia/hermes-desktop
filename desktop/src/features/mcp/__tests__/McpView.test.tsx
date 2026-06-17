import { fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { McpView } from '../McpView.js';

const {
  mockAdd,
  mockList,
  mockPatchDesktop,
  mockReload,
  mockRemove,
  mockTools,
} = vi.hoisted(() => ({
  mockAdd: vi.fn(),
  mockList: vi.fn(),
  mockPatchDesktop: vi.fn(),
  mockReload: vi.fn(),
  mockRemove: vi.fn(),
  mockTools: vi.fn(),
}));

vi.mock('@/services/api/router.js', () => ({
  api: {
    mcp: vi.fn().mockReturnValue({
      add: mockAdd,
      list: mockList,
      patchDesktop: mockPatchDesktop,
      reload: mockReload,
      remove: mockRemove,
      tools: mockTools,
    }),
  },
}));

describe('McpView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockList.mockResolvedValue({
      items: [
        {
          name: 'time',
          command: 'uvx',
          transport: 'stdio',
          valid: true,
          desktop: { pinned: false },
          status: { connected: false, status: 'disabled', tools: 0, disabled: true },
        },
      ],
      generated_at: '2026-06-17T00:00:00Z',
    });
    mockPatchDesktop.mockResolvedValue({ pinned: false, last_selected_at: '2026-06-17T00:00:00Z' });
    mockReload.mockResolvedValue({
      ok: true,
      items: [
        {
          name: 'time',
          command: 'uvx',
          transport: 'stdio',
          valid: true,
          desktop: { pinned: false },
          status: { connected: true, status: 'connected', tools: 1 },
        },
      ],
      generated_at: '2026-06-17T00:00:01Z',
    });
    mockTools.mockResolvedValue({
      items: [{ name: 'now', description: 'Current time' }],
      status: { connected: true, status: 'connected', tools: 1 },
    });
  });

  it('loads servers without discovering tools until a server is selected', async () => {
    render(() => <McpView />);

    await waitFor(() => screen.getByText('time'));
    expect(mockTools).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('time'));

    await waitFor(() => expect(mockTools).toHaveBeenCalledWith('time'));
    await waitFor(() => screen.getByText('now'));
    expect(mockPatchDesktop).toHaveBeenCalledWith(
      'time',
      expect.objectContaining({ last_selected_at: expect.any(String) }),
    );
  });

  it('renders configured status instead of forcing offline', async () => {
    mockList.mockResolvedValueOnce({
      items: [
        {
          name: 'configured-server',
          command: 'uvx',
          transport: 'stdio',
          valid: true,
          desktop: { pinned: false },
          status: { connected: false, status: 'configured', tools: 0 },
        },
        {
          name: 'connecting-server',
          command: 'uvx',
          transport: 'stdio',
          valid: true,
          desktop: { pinned: false },
          status: { connected: false, status: 'connecting', tools: 0 },
        },
        {
          name: 'failed-server',
          command: 'uvx',
          transport: 'stdio',
          valid: true,
          desktop: { pinned: false },
          status: { connected: false, status: 'failed', tools: 0, error: 'boom' },
        },
        {
          name: 'invalid-server',
          command: 'uvx',
          transport: 'stdio',
          valid: false,
          error: 'bad config',
          desktop: { pinned: false },
          status: null,
        },
      ],
      generated_at: '2026-06-17T00:00:00Z',
    });

    render(() => <McpView />);

    await waitFor(() => screen.getByText('configured-server'));
    expect(screen.getByText('Configured')).toBeTruthy();
    expect(screen.getByText('Connecting')).toBeTruthy();
    expect(screen.getByText('Failed')).toBeTruthy();
    expect(screen.getByText('Invalid')).toBeTruthy();
    expect(screen.getByText('bad config')).toBeTruthy();
    expect(screen.queryByText('Offline')).toBeNull();
  });

  it('reloads MCP only from the explicit reload action', async () => {
    render(() => <McpView />);

    await waitFor(() => screen.getByText('Reload MCP'));
    expect(mockReload).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('Reload MCP'));

    await waitFor(() => expect(mockReload).toHaveBeenCalledTimes(1));
    await waitFor(() => screen.getByText('Online'));
  });

  it('patches desktop metadata when pinning a server', async () => {
    render(() => <McpView />);

    await waitFor(() => screen.getByText('Pin'));
    fireEvent.click(screen.getByText('Pin'));

    await waitFor(() => expect(mockPatchDesktop).toHaveBeenCalledWith('time', { pinned: true }));
  });
});
