import { getNativeHost } from '@/services/native-host.js';
import type { FsAdapter } from './types.js';

function nativeHost() {
  const host = getNativeHost();
  if (!host) throw new Error('Hermes Studio native file access is unavailable');
  return host;
}

function isNotFound(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && (error as { code?: unknown }).code === 'HERMES_HOME_PATH_NOT_FOUND';
}

export class ElectronFsAdapter implements FsAdapter {
  async readText(relPath: string): Promise<string | null> {
    try {
      return await nativeHost().hermesHome.readText(relPath);
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async writeText(relPath: string, content: string): Promise<void> {
    await nativeHost().hermesHome.writeText(relPath, content);
  }

  async rename(relPath: string, newRelPath: string): Promise<void> {
    const text = await this.readText(relPath);
    if (text === null) return;
    await this.writeText(newRelPath, text);
    try {
      await this.writeText(relPath, '');
    } catch {
      // best-effort
    }
  }
}

export class MemoryFsAdapter implements FsAdapter {
  files = new Map<string, string>();

  async readText(relPath: string): Promise<string | null> {
    return this.files.has(relPath) ? this.files.get(relPath)! : null;
  }

  async writeText(relPath: string, content: string): Promise<void> {
    this.files.set(relPath, content);
  }

  async rename(relPath: string, newRelPath: string): Promise<void> {
    if (!this.files.has(relPath)) return;
    this.files.set(newRelPath, this.files.get(relPath)!);
    this.files.delete(relPath);
  }
}

export function createFsAdapter(): FsAdapter {
  return getNativeHost() ? new ElectronFsAdapter() : new MemoryFsAdapter();
}
