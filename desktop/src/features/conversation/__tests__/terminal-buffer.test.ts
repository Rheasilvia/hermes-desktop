import { describe, expect, it } from 'vitest';
import { readTerminalBufferWindow, type XtermBufferLike } from '../terminal-buffer.js';

/**
 * Build a fake xterm buffer over an array of line strings. `getLine` returns
 * undefined out of range, matching xterm's real API.
 */
function makeBuffer(
  lines: string[],
  opts: { viewportY?: number; baseY?: number; cursorY?: number } = {},
): XtermBufferLike {
  return {
    length: lines.length,
    viewportY: opts.viewportY ?? 0,
    baseY: opts.baseY ?? 0,
    cursorY: opts.cursorY ?? 0,
    getLine(index: number) {
      const value = lines[index];
      if (value === undefined) return undefined;
      // Real xterm right-trims when trimRight is true.
      return { translateToString: (trimRight?: boolean) => (trimRight ? value.replace(/\s+$/, '') : value) };
    },
  };
}

describe('readTerminalBufferWindow', () => {
  it('defaults to the visible screen (viewport top, `rows` lines)', () => {
    const buffer = makeBuffer(
      ['line0', 'line1', 'line2', 'line3', 'line4'],
      { viewportY: 2, baseY: 2, cursorY: 1 },
    );
    const result = readTerminalBufferWindow(buffer, 2);
    expect(result).toEqual({
      total_lines: 5,
      start: 2,
      end: 4,
      viewport_rows: 2,
      cursor_row: 3, // baseY(2) + cursorY(1)
      text: 'line2\nline3',
    });
  });

  it('reads an explicit [start, start+count) scrollback window', () => {
    const buffer = makeBuffer(['a', 'b', 'c', 'd', 'e'], { viewportY: 3 });
    const result = readTerminalBufferWindow(buffer, 2, { start: 1, count: 3 });
    expect(result.start).toBe(1);
    expect(result.end).toBe(4);
    expect(result.text).toBe('b\nc\nd');
  });

  it('clamps a window that runs past the end of the buffer', () => {
    const buffer = makeBuffer(['a', 'b', 'c']);
    const result = readTerminalBufferWindow(buffer, 24, { start: 2, count: 100 });
    expect(result.start).toBe(2);
    expect(result.end).toBe(3);
    expect(result.text).toBe('c');
  });

  it('returns an empty window for an out-of-range start', () => {
    const buffer = makeBuffer(['a', 'b', 'c']);
    const result = readTerminalBufferWindow(buffer, 24, { start: 50, count: 10 });
    expect(result.start).toBe(3); // clamped to total_lines
    expect(result.end).toBe(3);
    expect(result.text).toBe('');
  });

  it('right-trims trailing whitespace but keeps interior blank lines', () => {
    const buffer = makeBuffer(['top', '', 'bottom', '   ', '']);
    const result = readTerminalBufferWindow(buffer, 5, { start: 0, count: 5 });
    // Trailing blank rows are dropped; the interior blank line is preserved.
    expect(result.text).toBe('top\n\nbottom');
  });
});
