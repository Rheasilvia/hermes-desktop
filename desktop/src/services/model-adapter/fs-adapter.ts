import { invoke } from '@tauri-apps/api/core';
import type { FsAdapter } from './types.js';

export class TauriFsAdapter implements FsAdapter {
  async readText(relPath: string): Promise<string | null> {
    try {
      return await invoke<string>('read_file', { path: relPath });
    } catch (e) {
      const msg = String(e);
      if (msg.includes('No such file') || msg.includes('Failed to read file')) {
        return null;
      }
      throw e;
    }
  }

  async writeText(relPath: string, content: string): Promise<void> {
    await invoke<void>('write_file', { path: relPath, content });
  }

  async rename(relPath: string, newRelPath: string): Promise<void> {
    const text = await this.readText(relPath);
    if (text === null) return;
    await this.writeText(newRelPath, text);
    try {
      await invoke<void>('write_file', { path: relPath, content: '' });
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
  return new TauriFsAdapter();
}
