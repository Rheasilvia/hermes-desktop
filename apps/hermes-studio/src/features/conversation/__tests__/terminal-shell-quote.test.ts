import { describe, expect, it } from 'vitest';
import { quoteTerminalPath } from '../terminal-shell-quote.js';

describe('quoteTerminalPath', () => {
  it.each([
    {
      name: 'leaves a POSIX-safe path unquoted',
      path: '/repo/src/main.ts',
      shell: '/bin/zsh',
      platform: 'macos' as const,
      expected: '/repo/src/main.ts',
    },
    {
      name: 'escapes spaces and single quotes for POSIX shells',
      path: "/tmp/owner's report.txt",
      shell: '/bin/bash',
      platform: 'linux' as const,
      expected: "'/tmp/owner'\\''s report.txt'",
    },
    {
      name: 'preserves Windows backslashes and doubles PowerShell single quotes',
      path: String.raw`C:\Users\Hermes Studio\owner's & $draft[1].txt`,
      shell: String.raw`C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`,
      platform: 'windows' as const,
      expected: String.raw`'C:\Users\Hermes Studio\owner''s & $draft[1].txt'`,
    },
    {
      name: 'uses cmd double quotes without treating apostrophes as syntax',
      path: String.raw`C:\Hermes Studio\owner's & report.txt`,
      shell: String.raw`C:\Windows\System32\cmd.exe`,
      platform: 'windows' as const,
      expected: String.raw`"C:\Hermes Studio\owner's & report.txt"`,
    },
    {
      name: 'falls back to PowerShell-safe quoting for an unknown Windows shell',
      path: String.raw`C:\Hermes Studio\draft (final).txt`,
      shell: '',
      platform: 'windows' as const,
      expected: String.raw`'C:\Hermes Studio\draft (final).txt'`,
    },
  ])('$name', ({ path, shell, platform, expected }) => {
    expect(quoteTerminalPath(path, { shell, platform })).toBe(expected);
  });
});
