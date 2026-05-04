import { createSignal } from 'solid-js';

export interface UpdateInfo {
  version: string;
  notes: string | null;
  date: string | null;
}

interface TauriCore {
  invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T>;
}

interface TauriWindow extends Window {
  __TAURI__?: {
    core: TauriCore;
  };
}

const [updateAvailable, setUpdateAvailable] = createSignal<UpdateInfo | null>(null);
const [updateBannerVisible, setUpdateBannerVisible] = createSignal(false);
const [updateDownloading, setUpdateDownloading] = createSignal(false);
const [updateProgress, setUpdateProgress] = createSignal<string>('');

export { updateAvailable, updateBannerVisible, updateDownloading, updateProgress };

export async function checkForUpdates(): Promise<UpdateInfo | null> {
  if (typeof window === 'undefined') {
    return null;
  }
  const w = window as TauriWindow;
  if (!w.__TAURI__?.core) {
    return null;
  }
  try {
    const result = await w.__TAURI__.core.invoke<UpdateInfo | null>('check_for_updates');
    if (result) {
      setUpdateAvailable(result);
      setUpdateBannerVisible(true);
    }
    return result;
  } catch (err) {
    console.error('Failed to check for updates:', err);
    return null;
  }
}

export async function installUpdate(): Promise<boolean> {
  if (typeof window === 'undefined') {
    return false;
  }
  const w = window as TauriWindow;
  if (!w.__TAURI__?.core) {
    return false;
  }
  setUpdateDownloading(true);
  setUpdateProgress('Downloading update...');
  try {
    await w.__TAURI__.core.invoke('install_update');
    setUpdateDownloading(false);
    setUpdateBannerVisible(false);
    return true;
  } catch (err) {
    console.error('Failed to install update:', err);
    setUpdateDownloading(false);
    setUpdateProgress('');
    return false;
  }
}

export function dismissUpdateBanner(): void {
  setUpdateBannerVisible(false);
}
