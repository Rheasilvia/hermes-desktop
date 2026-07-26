import { fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OAuthProvider } from '@/services/api/types.js';
import type { HermesStudioBridge } from '@/shared/native-bridge.js';
import { installNativeHostMock } from '@/services/native-host.js';

const oauth = vi.hoisted(() => ({
  start: vi.fn(),
  submit: vi.fn(),
  poll: vi.fn(),
  cancelSession: vi.fn(),
  disconnect: vi.fn(),
}));

vi.mock('@/services/api/router.js', () => ({
  api: { oauth: () => oauth },
}));

import { OAuthConnectModal } from '../OAuthConnectModal.js';

const provider = (overrides: Partial<OAuthProvider> = {}): OAuthProvider => ({
  id: 'anthropic',
  name: 'Anthropic',
  flow: 'pkce',
  logged_in: false,
  source: null,
  has_refresh_token: false,
  ...overrides,
});

describe('OAuthConnectModal native links', () => {
  const openExternal = vi.fn();
  let restoreNativeHost = () => {};

  beforeEach(() => {
    vi.clearAllMocks();
    openExternal.mockResolvedValue(undefined);
    restoreNativeHost = installNativeHostMock({
      system: { openExternal },
    } as unknown as HermesStudioBridge);
  });

  afterEach(() => {
    restoreNativeHost();
    vi.restoreAllMocks();
  });

  it('opens OAuth authorization URLs through the native system bridge', async () => {
    oauth.start.mockResolvedValue({
      session_id: 'oauth-session',
      flow: 'pkce',
      auth_url: 'https://auth.example/authorize',
    });
    const windowOpen = vi.spyOn(window, 'open').mockImplementation(() => null);
    render(() => (
      <OAuthConnectModal open provider={provider()} onClose={vi.fn()} onConnected={vi.fn()} />
    ));

    fireEvent.click(screen.getByRole('button', { name: /Connect with Anthropic/ }));

    await waitFor(() => {
      expect(openExternal).toHaveBeenCalledWith('https://auth.example/authorize');
    });
    expect(windowOpen).not.toHaveBeenCalled();
  });

  it('routes provider documentation links through the native system bridge', () => {
    render(() => (
      <OAuthConnectModal
        open
        provider={provider({
          id: 'external-provider',
          name: 'External Provider',
          flow: 'external',
          docs_url: 'https://docs.example/provider',
        })}
        onClose={vi.fn()}
        onConnected={vi.fn()}
      />
    ));

    fireEvent.click(screen.getByRole('link', { name: /View documentation/ }));

    expect(openExternal).toHaveBeenCalledWith('https://docs.example/provider');
  });
});
