/**
 * terminal-read store — bridges the agent's `read_terminal` tool to the xterm
 * buffer living in a mounted {@link TerminalPanel}.
 *
 * The sidecar blocks the agent worker on a `terminal.read.request` SSE event
 * (mirroring clarify/secret) and waits for the renderer to POST the answer.
 * Each mounted TerminalPanel registers a responder here keyed by its owning
 * session id; the most-recently-registered responder is also tracked as a
 * fallback so a request can be answered even when the panel's session id is
 * unknown (e.g. a terminal opened before any session was attached).
 *
 * A responder reads the requested [start, start+count) window from its xterm
 * buffer and returns the serialized JSON string the tool expects, or `null`
 * when it cannot answer (terminal not running). `null` lets the caller fall
 * back to the empty-payload answer so the tool never hangs.
 */

/** The line-window a `read_terminal` call requested. Both omitted = visible screen. */
export interface TerminalReadWindow {
  start?: number;
  count?: number;
}

/** Serialized answer to a read_terminal request; matches the tool's contract. */
export interface TerminalReadResult {
  total_lines: number;
  start: number;
  end: number;
  viewport_rows: number;
  cursor_row: number;
  text: string;
}

/** Reads a line window from a mounted terminal, or null if it cannot answer. */
export type TerminalReadResponder = (window: TerminalReadWindow) => TerminalReadResult | null;

interface Registration {
  sessionId: string | null;
  responder: TerminalReadResponder;
}

// Insertion-ordered so the newest registration wins the fallback lookup.
const registrations = new Map<symbol, Registration>();

/** Empty answer used when no terminal is open so the tool resolves promptly. */
export function emptyTerminalReadResult(window: TerminalReadWindow): TerminalReadResult {
  const start = Math.max(0, Math.floor(window.start ?? 0));
  return { total_lines: 0, start, end: start, viewport_rows: 0, cursor_row: 0, text: '' };
}

export const terminalReadStore = {
  /**
   * Register a panel's responder. Returns an unregister function to call on
   * cleanup. `sessionId` is the panel's owning chat session (may be null).
   */
  register(sessionId: string | null | undefined, responder: TerminalReadResponder): () => void {
    const key = Symbol('terminal-responder');
    registrations.set(key, { sessionId: sessionId?.trim() || null, responder });
    return () => {
      registrations.delete(key);
    };
  },

  /**
   * Resolve a read_terminal request for `sessionId` against the requested
   * window. Prefers a responder registered for that exact session; otherwise
   * falls back to the most-recently-registered responder. Returns null when no
   * responder can answer (no terminal open) so the caller sends an empty payload.
   */
  read(sessionId: string | null | undefined, window: TerminalReadWindow): TerminalReadResult | null {
    const sid = sessionId?.trim() || null;
    // Newest-first (Map preserves insertion order, so reverse the values).
    const newestFirst = [...registrations.values()].reverse();
    const ordered = sid
      ? [
          ...newestFirst.filter((entry) => entry.sessionId === sid),
          ...newestFirst.filter((entry) => entry.sessionId !== sid),
        ]
      : newestFirst;
    for (const entry of ordered) {
      const result = entry.responder(window);
      if (result) return result;
    }
    return null;
  },
};
