import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HermesStudioBridge } from '@/shared/native-bridge.js';
import { installNativeHostMock } from '@/services/native-host.js';
import { createFsAdapter, ElectronFsAdapter, MemoryFsAdapter } from '../fs-adapter.js';

let restoreHost: (() => void) | undefined;

afterEach(() => {
  restoreHost?.();
  restoreHost = undefined;
});

describe('ElectronFsAdapter', () => {
  it('reads and writes through the contained Hermes Home bridge', async () => {
    const readText = vi.fn(async () => '{"ok":true}');
    const writeText = vi.fn(async () => undefined);
    restoreHost = installNativeHostMock({
      hermesHome: { readText, writeText },
    } as unknown as HermesStudioBridge);
    const adapter = new ElectronFsAdapter();

    await expect(adapter.readText('desktop/models.json')).resolves.toBe('{"ok":true}');
    await adapter.writeText('desktop/models.json', '{}');

    expect(readText).toHaveBeenCalledWith('desktop/models.json');
    expect(writeText).toHaveBeenCalledWith('desktop/models.json', '{}');
  });

  it('maps a native not-found error to the FsAdapter null contract', async () => {
    const readText = vi.fn(async () => {
      throw { code: 'HERMES_HOME_PATH_NOT_FOUND', message: 'missing' };
    });
    restoreHost = installNativeHostMock({ hermesHome: { readText } } as unknown as HermesStudioBridge);

    await expect(new ElectronFsAdapter().readText('missing.json')).resolves.toBeNull();
  });

  it('preserves the existing atomic-persistence rename contract through contained writes', async () => {
    const readText = vi.fn(async () => 'payload');
    const writeText = vi.fn(async () => undefined);
    restoreHost = installNativeHostMock({
      hermesHome: { readText, writeText },
    } as unknown as HermesStudioBridge);

    await new ElectronFsAdapter().rename('desktop/models.tmp', 'desktop/models.json');

    expect(writeText.mock.calls).toEqual([
      ['desktop/models.json', 'payload'],
      ['desktop/models.tmp', ''],
    ]);
  });

  it('chooses an in-memory adapter in browser preview', () => {
    restoreHost = installNativeHostMock(null);
    expect(createFsAdapter()).toBeInstanceOf(MemoryFsAdapter);
  });

  it('chooses the Electron adapter when the preload bridge exists', () => {
    restoreHost = installNativeHostMock({ hermesHome: {} } as unknown as HermesStudioBridge);
    expect(createFsAdapter()).toBeInstanceOf(ElectronFsAdapter);
  });
});
