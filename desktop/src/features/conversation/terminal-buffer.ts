/**
 * Pure helpers for reading a line window out of an xterm buffer.
 *
 * Extracted from {@link TerminalPanel} so the windowing/metadata logic that
 * answers the `read_terminal` agent tool can be unit-tested without a live
 * xterm instance. Operates on the minimal slice of `Terminal.buffer.active`
 * we actually use.
 */

/** The subset of an xterm buffer line we read. */
export interface XtermBufferLineLike {
  translateToString(trimRight?: boolean): string;
}

/** The subset of `Terminal.buffer.active` this module depends on. */
export interface XtermBufferLike {
  /** Total lines including scrollback. */
  readonly length: number;
  /** Row of the top of the viewport within the buffer. */
  readonly viewportY: number;
  /** Absolute row of the first line of the viewport (scrollback offset). */
  readonly baseY: number;
  /** Cursor row, relative to the viewport top. */
  readonly cursorY: number;
  getLine(index: number): XtermBufferLineLike | undefined;
}

export interface TerminalReadWindowInput {
  start?: number;
  count?: number;
}

export interface TerminalBufferWindow {
  total_lines: number;
  start: number;
  end: number;
  viewport_rows: number;
  cursor_row: number;
  text: string;
}

/**
 * Read a `[start, start + count)` line window from an xterm buffer and return
 * the window text plus buffer metadata, matching the `read_terminal` tool's
 * JSON contract `{total_lines, start, end, viewport_rows, cursor_row, text}`.
 *
 * Defaults (no `start`/`count`) return the visible screen: `start` is the
 * viewport top and `count` is `rows`. The window is clamped to
 * `[0, total_lines)`, so out-of-range requests yield an empty window rather
 * than throwing. `cursor_row` is absolute (baseY + cursorY) so the agent can
 * locate the prompt within `total_lines`.
 */
export function readTerminalBufferWindow(
  buffer: XtermBufferLike,
  rows: number,
  window: TerminalReadWindowInput = {},
): TerminalBufferWindow {
  const total = Math.max(0, buffer.length);
  const viewportRows = Math.max(0, rows);

  const requestedStart = window.start;
  const requestedCount = window.count;

  // Default window = the visible screen (viewport top, `rows` lines).
  const rawStart = requestedStart != null ? Math.floor(requestedStart) : buffer.viewportY;
  const start = Math.min(Math.max(0, rawStart), total);
  const rawCount = requestedCount != null ? Math.floor(requestedCount) : viewportRows;
  const count = Math.max(0, rawCount);
  const end = Math.min(start + count, total);

  const lines: string[] = [];
  for (let index = start; index < end; index += 1) {
    const line = buffer.getLine(index);
    if (line) lines.push(line.translateToString(true));
  }

  return {
    total_lines: total,
    start,
    end,
    viewport_rows: viewportRows,
    cursor_row: buffer.baseY + buffer.cursorY,
    // trimEnd (not trim) so leading blank scrollback lines keep their row
    // alignment with `start`, while trailing whitespace is dropped.
    text: lines.join('\n').replace(/\s+$/, ''),
  };
}
