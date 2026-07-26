import type { NativePlatform } from '@/shared/native-bridge.js';

interface TerminalShellContext {
  shell?: string | null;
  platform?: NativePlatform | null;
}

type ShellFamily = 'cmd' | 'powershell' | 'posix';

function shellFamily({ shell, platform }: TerminalShellContext): ShellFamily {
  const executable = (shell ?? '').split(/[\\/]/).pop()?.toLowerCase() ?? '';
  if (executable.startsWith('pwsh') || executable.startsWith('powershell')) {
    return 'powershell';
  }
  if (executable.startsWith('cmd')) return 'cmd';
  if (/(?:^|[-_.])(ba|z|fi|da|k)?sh(?:\.exe)?$/.test(executable)) return 'posix';
  return platform === 'windows' ? 'powershell' : 'posix';
}

/** Quote one native path as a literal argument for the PTY's active shell. */
export function quoteTerminalPath(path: string, context: TerminalShellContext): string {
  switch (shellFamily(context)) {
    case 'powershell':
      return `'${path.replace(/'/g, "''")}'`;
    case 'cmd':
      // Windows filenames cannot contain a double quote. Keeping the whole
      // argument quoted makes spaces, ampersands, and apostrophes literal.
      return `"${path}"`;
    case 'posix':
      if (/^[A-Za-z0-9_./:-]+$/.test(path)) return path;
      return `'${path.replace(/'/g, "'\\''")}'`;
  }
}
