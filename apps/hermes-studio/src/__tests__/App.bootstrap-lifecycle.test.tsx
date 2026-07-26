import { fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  connect: vi.fn(),
  sessionList: vi.fn(async () => []),
  initBootstrap: vi.fn(),
  initializeStores: vi.fn(),
  gateways: [] as Array<{ disconnect: ReturnType<typeof vi.fn> }>,
}));

vi.mock('@solidjs/router', () => ({
  Router: (props: { children?: unknown }) => <>{props.children}</>,
  Route: () => null,
  useNavigate: () => vi.fn(),
  useParams: () => ({}),
}));

vi.mock('@/shell/AppLayout', () => ({
  AppLayout: (props: { children?: unknown }) => <>{props.children}</>,
}));
vi.mock('@/shell/ModuleErrorBoundary', () => ({
  ModuleErrorBoundary: (props: { children?: unknown }) => <>{props.children}</>,
}));
vi.mock('@/ui/atoms/LoadingSpinner', () => ({
  LoadingSpinner: (props: { label: string }) => <span>{props.label}</span>,
}));
vi.mock('@/ui/molecules/Toast.js', () => ({ ToastHost: () => null }));
vi.mock('@/stores/context.js', () => ({ initializeStores: mocks.initializeStores }));
vi.mock('@/services/gateway/index.js', () => ({
  createHttpGateway: () => {
    const gateway = {
      session: { list: mocks.sessionList },
      connect: mocks.connect,
      disconnect: vi.fn(async () => undefined),
    };
    mocks.gateways.push(gateway);
    return gateway;
  },
}));
vi.mock('@/shell/bootstrap.js', () => ({ initBootstrap: mocks.initBootstrap }));
vi.mock('@/stores/models.js', () => ({
  modelsStore: { load: vi.fn(), loadActive: vi.fn() },
}));

import App from '../App.js';

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((next, fail) => {
    resolve = next;
    reject = fail;
  });
  return { promise, resolve, reject };
}

describe('App bootstrap lifecycle', () => {
  beforeEach(() => {
    mocks.connect.mockReset();
    mocks.initBootstrap.mockReset();
    mocks.initializeStores.mockReset();
    mocks.sessionList.mockReset().mockResolvedValue([]);
    mocks.gateways.length = 0;
  });

  it('releases failed bootstrap subscriptions before retry and active subscriptions on unmount', async () => {
    const firstDispose = vi.fn();
    const secondDispose = vi.fn();
    mocks.initBootstrap
      .mockResolvedValueOnce(firstDispose)
      .mockResolvedValueOnce(secondDispose);
    mocks.connect
      .mockRejectedValueOnce(new Error('backend connect failed'))
      .mockResolvedValueOnce(undefined);

    const view = render(() => <App />);

    await screen.findByText('backend connect failed');
    expect(firstDispose).toHaveBeenCalledOnce();
    expect(mocks.gateways[0]?.disconnect).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(mocks.initBootstrap).toHaveBeenCalledTimes(2));
    expect(firstDispose).toHaveBeenCalledOnce();

    view.unmount();
    expect(secondDispose).toHaveBeenCalledOnce();
    expect(mocks.gateways[1]?.disconnect).toHaveBeenCalledOnce();
  });

  it.each(['resolve', 'reject'] as const)(
    'ignores a superseded retry that finishes late via %s',
    async (settlement) => {
      const initialDispose = vi.fn();
      const staleDispose = vi.fn();
      const currentDispose = vi.fn();
      const staleConnect = deferred<void>();
      mocks.initBootstrap
        .mockResolvedValueOnce(initialDispose)
        .mockResolvedValueOnce(staleDispose)
        .mockResolvedValueOnce(currentDispose);
      mocks.connect
        .mockRejectedValueOnce(new Error('initial connect failed'))
        .mockImplementationOnce(() => staleConnect.promise)
        .mockResolvedValueOnce(undefined);

      const view = render(() => <App />);
      const retry = await screen.findByRole('button', { name: 'Retry' });

      fireEvent.click(retry);
      await waitFor(() => expect(mocks.connect).toHaveBeenCalledTimes(2));
      // Retry is hidden while booting. Reattach the same delegated button to
      // model a second trigger racing in from an already-dispatched UI event.
      document.body.append(retry);
      fireEvent.click(retry);
      await waitFor(() => expect(mocks.connect).toHaveBeenCalledTimes(3));
      await waitFor(() => expect(screen.queryByText('initial connect failed')).toBeNull());

      if (settlement === 'resolve') staleConnect.resolve(undefined);
      else staleConnect.reject(new Error('stale connect failed'));
      await Promise.resolve();
      await Promise.resolve();

      expect(screen.queryByText('stale connect failed')).toBeNull();
      expect(screen.queryByText('initial connect failed')).toBeNull();
      expect(staleDispose).toHaveBeenCalledOnce();
      expect(currentDispose).not.toHaveBeenCalled();
      expect(mocks.gateways[1]?.disconnect.mock.calls.length).toBeGreaterThanOrEqual(2);
      expect(mocks.gateways[2]?.disconnect).not.toHaveBeenCalled();

      retry.remove();
      view.unmount();
      expect(currentDispose).toHaveBeenCalledOnce();
      expect(mocks.gateways[2]?.disconnect).toHaveBeenCalledOnce();
    },
  );
});
