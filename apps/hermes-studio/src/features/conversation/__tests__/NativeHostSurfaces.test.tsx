import { fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HermesStudioBridge } from '@/shared/native-bridge.js';
import { installNativeHostMock } from '@/services/native-host.js';
import { ImageCard } from '../ImageCard.js';
import { WorkspacePicker } from '../WorkspacePicker.js';

const hostCalls = {
  selectForSession: vi.fn(),
  urlForPath: vi.fn(),
  copyRemoteImage: vi.fn(),
};

describe('native-host renderer surfaces', () => {
  let restoreNativeHost = () => {};

  beforeEach(() => {
    hostCalls.selectForSession.mockReset();
    hostCalls.urlForPath.mockReset();
    hostCalls.copyRemoteImage.mockReset();
    hostCalls.copyRemoteImage.mockResolvedValue(undefined);
    restoreNativeHost = installNativeHostMock({
      workspace: { selectForSession: hostCalls.selectForSession },
      assets: { urlForPath: hostCalls.urlForPath },
      clipboard: { copyRemoteImage: hostCalls.copyRemoteImage },
    } as unknown as HermesStudioBridge);
  });

  afterEach(() => {
    restoreNativeHost();
  });

  it('selects a workspace through the session-scoped native bridge', async () => {
    hostCalls.selectForSession.mockResolvedValue('C:\\workspaces\\Hermes');
    const onChange = vi.fn();
    render(() => (
      <WorkspacePicker
        sessionId="session-workspace"
        workspacePath="C:\\workspaces\\Old"
        editable
        onChange={onChange}
      />
    ));

    fireEvent.click(screen.getByRole('button', { name: 'Change workspace folder' }));

    await waitFor(() => {
      expect(hostCalls.selectForSession).toHaveBeenCalledWith('session-workspace');
      expect(onChange).toHaveBeenCalledWith('C:\\workspaces\\Hermes');
    });
  });

  it('discards a workspace selection that resolves after the active session changes', async () => {
    let resolveSelection!: (path: string) => void;
    hostCalls.selectForSession.mockReturnValue(new Promise((resolve) => {
      resolveSelection = resolve;
    }));
    const onChange = vi.fn();
    let switchSession!: (sessionId: string) => void;
    const Harness = () => {
      const [sessionId, setSessionId] = createSignal('workspace-a');
      switchSession = setSessionId;
      return (
        <WorkspacePicker
          sessionId={sessionId()}
          workspacePath="/old"
          editable
          onChange={onChange}
        />
      );
    };
    render(() => <Harness />);

    fireEvent.click(screen.getByRole('button', { name: 'Change workspace folder' }));
    await waitFor(() => expect(hostCalls.selectForSession).toHaveBeenCalledWith('workspace-a'));
    switchSession('workspace-b');
    resolveSelection('/workspace/from-a');
    await Promise.resolve();

    expect(onChange).not.toHaveBeenCalled();
  });

  it('resolves local image paths to opaque asset URLs before rendering', async () => {
    hostCalls.urlForPath.mockResolvedValue('hermes-studio-asset://asset/opaque-session-image-handle');
    const localPath = String.raw`C:\private\image.png`;
    const { container } = render(() => <ImageCard url={localPath} altText="Local image" />);

    await waitFor(() => {
      expect(hostCalls.urlForPath).toHaveBeenCalledWith(localPath);
      expect(container.querySelector('img')?.getAttribute('src')).toBe('hermes-studio-asset://asset/opaque-session-image-handle');
    });
    expect(container.querySelector('img[src="C:\\private\\image.png"]')).toBeNull();

    await fireEvent.load(container.querySelector('img')!);
    expect(screen.queryByRole('button', { name: 'Copy image to clipboard' })).toBeNull();
  });

  it('does not try to re-sign an existing opaque asset URL', async () => {
    const opaqueUrl = 'hermes-studio-asset://asset/already-signed-handle';
    const { container } = render(() => <ImageCard url={opaqueUrl} altText="Opaque image" />);

    await waitFor(() => {
      expect(container.querySelector('img')?.getAttribute('src')).toBe(opaqueUrl);
    });
    expect(hostCalls.urlForPath).not.toHaveBeenCalled();
  });

  it('does not treat a malformed native asset prefix as an opaque URL', async () => {
    hostCalls.urlForPath.mockResolvedValue('hermes-studio-asset://asset/resolved-opaque-handle');
    const malformed = 'hermes-studio-asset://private/relative-local-path';
    const { container } = render(() => <ImageCard url={malformed} altText="Malformed image" />);

    await waitFor(() => {
      expect(hostCalls.urlForPath).toHaveBeenCalledWith(malformed);
      expect(container.querySelector('img')?.getAttribute('src'))
        .toBe('hermes-studio-asset://asset/resolved-opaque-handle');
    });
  });

  it('never renders a raw path returned by the native asset resolver', async () => {
    hostCalls.urlForPath.mockResolvedValue('/private/session/image.png');
    const { container } = render(() => <ImageCard url="/private/source.png" altText="Local image" />);

    await waitFor(() => expect(hostCalls.urlForPath).toHaveBeenCalledWith('/private/source.png'));
    await Promise.resolve();

    expect(container.querySelector('img')).toBeNull();
  });

  it('copies only allowed remote HTTP images through the bridge', async () => {
    const { container } = render(() => <ImageCard url="https://images.example/cat.png" altText="Remote image" />);
    await fireEvent.load(container.querySelector('img')!);

    const copy = await screen.findByRole('button', { name: 'Copy image to clipboard' });
    fireEvent.click(copy);

    expect(hostCalls.urlForPath).not.toHaveBeenCalled();
    expect(hostCalls.copyRemoteImage).toHaveBeenCalledWith('https://images.example/cat.png');
  });
});
