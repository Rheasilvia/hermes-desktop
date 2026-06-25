import { invoke, isTauri } from '@tauri-apps/api/core';
import { FitAddon } from '@xterm/addon-fit';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { WebglAddon } from '@xterm/addon-webgl';
import { Terminal as XTerm, type ITheme } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import type { Component } from 'solid-js';
import { Show, createEffect, createSignal, onCleanup, onMount } from 'solid-js';
import styles from './TerminalPanel.module.css';

interface TerminalPanelProps {
  active: boolean;
  cwd: string | null;
}

interface TerminalStartResult {
  id: string;
  pid: number | null;
  shell: string;
  cwd: string;
  reused: boolean;
}

interface TerminalDataEvent {
  id: string;
  // Raw bytes from the PTY (see terminal.rs::TerminalDataEvent). Avoids the
  // UTF-8-lossy middle layer that corrupted multi-byte sequences spanning
  // read-chunk boundaries. Reconstructed into a Uint8Array for xterm.
  data: number[];
}

interface TerminalExitEvent {
  id: string;
  code: number;
  signal: string | null;
}

interface TerminalErrorEvent {
  id: string;
  error: string;
}

type TerminalThemeName = 'light' | 'dark' | 'earth';

const terminalThemes: Record<TerminalThemeName, ITheme> = {
  light: {
    background: '#fbfcff',
    foreground: '#17171a',
    cursor: '#17171a',
    selectionBackground: '#0053fd33',
    black: '#17171a',
    red: '#cf2d56',
    green: '#1f8a65',
    yellow: '#9a6a12',
    blue: '#0053fd',
    magenta: '#a12c7a',
    cyan: '#167a85',
    white: '#e8efff',
    brightBlack: '#6f7480',
    brightRed: '#e14868',
    brightGreen: '#299a73',
    brightYellow: '#b9821c',
    brightBlue: '#2f72ff',
    brightMagenta: '#bd3e92',
    brightCyan: '#20929e',
    brightWhite: '#ffffff',
  },
  dark: {
    background: '#0a0c10',
    foreground: '#dce4f5',
    cursor: '#dce4f5',
    selectionBackground: '#5b8dff44',
    black: '#0a0c10',
    red: '#f05070',
    green: '#4cc58a',
    yellow: '#f2cc60',
    blue: '#5b8dff',
    magenta: '#d8b9ff',
    cyan: '#76e3ea',
    white: '#dce4f5',
    brightBlack: '#7a88a8',
    brightRed: '#ff8198',
    brightGreen: '#74e0a7',
    brightYellow: '#f7d984',
    brightBlue: '#8eb0ff',
    brightMagenta: '#e4caff',
    brightCyan: '#a3f2f7',
    brightWhite: '#f5f8ff',
  },
  earth: {
    background: '#100a04',
    foreground: '#f5d5a5',
    cursor: '#f5d5a5',
    selectionBackground: '#e07a3044',
    black: '#100a04',
    red: '#ff6b6b',
    green: '#73d673',
    yellow: '#d9a441',
    blue: '#9bc3ff',
    magenta: '#e58bc8',
    cyan: '#7ed6cf',
    white: '#f5d5a5',
    brightBlack: '#b07a50',
    brightRed: '#ff8a8a',
    brightGreen: '#9af09a',
    brightYellow: '#f2c45f',
    brightBlue: '#bdd8ff',
    brightMagenta: '#f0a9d8',
    brightCyan: '#a2ece6',
    brightWhite: '#fff1d8',
  },
};

const fallbackTerminalSize = {
  cols: 80,
  rows: 24,
};

const maxPendingOutputChunks = 64;

const terminalControlSequencePattern = /\x1b\][^\x07]*(?:\x07|\x1b\\)|\x1b\[[0-?]*[ -/]*[@-~]|\x1b[@-_]/g;

const stripTerminalControlSequences = (value: string) =>
  value.replace(terminalControlSequencePattern, '');

const ctrlKeyToTerminalInput = (key: string) => {
  if (key.length !== 1) return null;
  const code = key.toUpperCase().charCodeAt(0);
  if (code >= 64 && code <= 95) {
    return String.fromCharCode(code - 64);
  }
  return null;
};

const keyToTerminalInput = (event: KeyboardEvent) => {
  if (event.isComposing || event.metaKey) return null;

  if (event.ctrlKey) {
    return ctrlKeyToTerminalInput(event.key);
  }

  const keyMap: Record<string, string> = {
    ArrowDown: '\x1b[B',
    ArrowLeft: '\x1b[D',
    ArrowRight: '\x1b[C',
    ArrowUp: '\x1b[A',
    Backspace: '\x7f',
    Delete: '\x1b[3~',
    End: '\x1b[F',
    Enter: '\r',
    Escape: '\x1b',
    Home: '\x1b[H',
    PageDown: '\x1b[6~',
    PageUp: '\x1b[5~',
    Tab: '\t',
  };
  const mapped = keyMap[event.key];
  if (mapped) return event.altKey ? `\x1b${mapped}` : mapped;
  if (event.key.length === 1) return event.altKey ? `\x1b${event.key}` : event.key;
  return null;
};

export const TerminalPanel: Component<TerminalPanelProps> = (props) => {
  let host: HTMLDivElement | undefined;
  let xtermHost: HTMLDivElement | undefined;
  let terminal: XTerm | null = null;
  let fitAddon: FitAddon | null = null;
  let webglAddon: WebglAddon | null = null;
  let resizeObserver: ResizeObserver | null = null;
  let unlistenData: (() => void) | null = null;
  let unlistenExit: (() => void) | null = null;
  let unlistenError: (() => void) | null = null;
  let dataDisposable: { dispose: () => void } | null = null;
  let pendingFrame: number | null = null;
  let themeObserver: MutationObserver | null = null;
  let textEncoder: TextEncoder | null = null;
  let textDecoder: TextDecoder | null = null;
  let runningStatus = 'Terminal running';
  let terminalEventsReady = false;
  let disposed = false;
  let focusingHost = false;
  let xtermDataEpoch = 0;
  const pendingOutput = new Map<string, number[][]>();

  const [sessionId, setSessionId] = createSignal<string | null>(null);
  const [starting, setStarting] = createSignal(false);
  const [running, setRunning] = createSignal(false);
  const [status, setStatus] = createSignal('Terminal idle');
  const [error, setError] = createSignal<string | null>(null);
  const [hasOutput, setHasOutput] = createSignal(false);
  // Latched once a start attempt fails so auto-start (onMount, the active
  // effect, and the ResizeObserver) stops retrying. A persistent PTY spawn
  // failure otherwise re-fires on every layout tick, flashing the error and
  // hammering the backend.
  const [startBlocked, setStartBlocked] = createSignal(false);

  const resolveThemeName = (): TerminalThemeName => {
    if (typeof document === 'undefined') return 'light';
    const theme = document.documentElement.dataset.theme;
    return theme === 'dark' || theme === 'earth' ? theme : 'light';
  };

  const applyTerminalTheme = () => {
    if (!terminal) return;
    terminal.options.theme = terminalThemes[resolveThemeName()];
  };

  const hostIsReady = () => {
    if (!host) return false;
    return host.clientWidth > 0 && host.clientHeight > 0;
  };

  const focusTerminal = () => {
    if (!props.active) return;
    if (host && document.activeElement !== host) {
      focusingHost = true;
      host.focus({ preventScroll: true });
      focusingHost = false;
    }
    terminal?.focus();
  };

  const handleHostFocus = () => {
    if (focusingHost || !props.active) return;
    terminal?.focus();
  };

  const markOutputRendered = () => {
    setHasOutput(true);
    setStatus(runningStatus);
  };

  const hasVisibleTerminalText = (data: number[]) => {
    if (!textDecoder) textDecoder = new TextDecoder();
    const text = textDecoder.decode(new Uint8Array(data), { stream: true });
    return stripTerminalControlSequences(text).replace(/[\x00-\x1f\x7f\s%]/g, '').length > 0;
  };

  const writeTerminalData = (data: number[]) => {
    const visible = hasVisibleTerminalText(data);
    terminal?.write(new Uint8Array(data), () => {
      if (visible) markOutputRendered();
    });
  };

  const sendTerminalInput = (input: string) => {
    const id = sessionId();
    if (!id || !running()) return;
    if (!textEncoder) textEncoder = new TextEncoder();
    const bytes = Array.from(textEncoder.encode(input));
    void invoke('terminal_write', { id, data: bytes }).catch((err) => setError(String(err)));
  };

  const handleHostKeyDown = (event: KeyboardEvent) => {
    const input = keyToTerminalInput(event);
    if (!input) return;
    const epoch = xtermDataEpoch;
    if (event.target === host) {
      event.preventDefault();
      event.stopPropagation();
    }
    queueMicrotask(() => {
      if (!disposed && xtermDataEpoch === epoch) {
        sendTerminalInput(input);
      }
    });
  };

  const queuePendingOutput = (id: string, data: number[]) => {
    const chunks = pendingOutput.get(id) ?? [];
    chunks.push(data);
    if (chunks.length > maxPendingOutputChunks) {
      chunks.splice(0, chunks.length - maxPendingOutputChunks);
    }
    pendingOutput.set(id, chunks);
  };

  const drainPendingOutput = (id: string) => {
    const chunks = pendingOutput.get(id);
    if (!chunks) return;
    pendingOutput.delete(id);
    for (const chunk of chunks) {
      writeTerminalData(chunk);
    }
  };

  const scheduleFrame = (callback: () => void) => {
    if (pendingFrame !== null) return;
    if (typeof requestAnimationFrame === 'function') {
      pendingFrame = requestAnimationFrame(() => {
        pendingFrame = null;
        callback();
      });
      return;
    }
    queueMicrotask(callback);
  };

  const fitAndResize = (options: { focus?: boolean; refresh?: boolean } = {}) => {
    if (!terminal || !fitAddon || !hostIsReady()) return false;
    try {
      fitAddon.fit();
    } catch {
      return false;
    }
    if (options.refresh) {
      terminal.refresh(0, Math.max(terminal.rows - 1, 0));
    }
    if (options.focus) focusTerminal();
    const id = sessionId();
    if (!id || !running()) return true;
    void invoke('terminal_resize', {
      id,
      cols: terminal.cols,
      rows: terminal.rows,
    }).catch((err) => setError(String(err)));
    return true;
  };

  const activateTerminalSurface = () => {
    scheduleFrame(() => {
      fitAndResize({ focus: true, refresh: true });
      if (props.active && !sessionId() && !starting()) {
        void ensureStarted();
      }
    });
  };

  const ensureStarted = async () => {
    if (disposed || sessionId() || starting() || startBlocked()) return;
    if (!terminal) return;
    if (!isTauri()) {
      setStatus('Terminal is available in the desktop app.');
      return;
    }
    if (!terminalEventsReady) return;
    if (!hostIsReady()) {
      setStatus('Waiting for terminal layout...');
      return;
    }

    setStarting(true);
    setError(null);
    setHasOutput(false);
    setStatus('Starting terminal...');
    fitAndResize();

    try {
      const result = await invoke<TerminalStartResult>('terminal_start', {
        cwd: props.cwd,
        cols: terminal.cols || fallbackTerminalSize.cols,
        rows: terminal.rows || fallbackTerminalSize.rows,
      });
      if (disposed) {
        void invoke('terminal_stop', { id: result.id }).catch(() => {});
        return;
      }
      runningStatus = `${result.reused ? 'Attached' : 'Running'} ${result.shell} in ${result.cwd}`;
      setSessionId(result.id);
      setRunning(true);
      setStatus(runningStatus);
      drainPendingOutput(result.id);
      fitAndResize({ focus: true, refresh: true });
    } catch (err) {
      if (disposed) return;
      setError(String(err));
      setStatus('Terminal failed to start');
      setStartBlocked(true);
    } finally {
      if (!disposed) setStarting(false);
    }
  };

  const retryTerminalStart = () => {
    if (starting()) return;
    setStartBlocked(false);
    setError(null);
    setStatus('Terminal idle');
    void ensureStarted();
  };

  onMount(async () => {
    if (!host || !xtermHost) return;
    terminal = new XTerm({
      allowProposedApi: true,
      convertEol: true,
      cursorBlink: true,
      cursorStyle: 'block',
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
      fontSize: 12,
      fontWeight: 'normal',
      fontWeightBold: 'bold',
      letterSpacing: 0,
      lineHeight: 1.2,
      minimumContrastRatio: 4.5,
      scrollback: 5000,
      theme: terminalThemes[resolveThemeName()],
    });
    fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.loadAddon(new WebLinksAddon());
    terminal.loadAddon(new Unicode11Addon());
    terminal.unicode.activeVersion = '11';
    terminal.open(xtermHost);
    // Tauri's macOS WebView can report a healthy WebGL canvas while painting
    // blank. Keep DOM rendering on the local desktop path; browser preview and
    // other non-Tauri hosts can still use WebGL when available.
    if (!isTauri()) {
      try {
        const webgl = new WebglAddon();
        webgl.onContextLoss(() => {
          webgl.dispose();
          if (webglAddon === webgl) webglAddon = null;
        });
        terminal.loadAddon(webgl);
        webglAddon = webgl;
      } catch (err) {
        // WebGL unavailable (headless test env, disabled GPU) — DOM renderer keeps working.
        console.warn('[hermes-terminal] WebGL unavailable; falling back to DOM', err);
      }
    }
    if (typeof MutationObserver !== 'undefined') {
      themeObserver = new MutationObserver(applyTerminalTheme);
      themeObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['data-theme'],
      });
    }
    dataDisposable = terminal.onData((data) => {
      const id = sessionId();
      if (!id || !running()) return;
      xtermDataEpoch += 1;
      // xterm hands us a string; the PTY backend takes raw bytes so non-UTF-8
      // key sequences round-trip correctly. Encode once and forward.
      sendTerminalInput(data);
    });

    if (isTauri()) {
      const { listen } = await import('@tauri-apps/api/event');
      if (disposed) return;
      unlistenData = await listen<TerminalDataEvent>('terminal_data', (event) => {
        const current = sessionId();
        if (!current) {
          queuePendingOutput(event.payload.id, event.payload.data);
          return;
        }
        if (event.payload.id !== current) return;
        writeTerminalData(event.payload.data);
      });
      if (disposed) {
        unlistenData();
        unlistenData = null;
        return;
      }
      unlistenExit = await listen<TerminalExitEvent>('terminal_exit', (event) => {
        const current = sessionId();
        if (!current || event.payload.id !== current) return;
        setRunning(false);
        setSessionId(null);
        setHasOutput(false);
        setStatus(event.payload.signal
          ? `Terminal exited: ${event.payload.signal}`
          : `Terminal exited with code ${event.payload.code}`);
      });
      if (disposed) {
        unlistenExit();
        unlistenExit = null;
        return;
      }
      unlistenError = await listen<TerminalErrorEvent>('terminal_error', (event) => {
        const current = sessionId();
        if (!current || event.payload.id !== current) return;
        setError(event.payload.error);
        setStatus('Terminal error');
      });
      if (disposed) {
        unlistenError();
        unlistenError = null;
        return;
      }
    }
    terminalEventsReady = true;

    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => {
        scheduleFrame(() => {
          fitAndResize({ refresh: props.active });
          if (props.active && !sessionId() && !starting()) {
            void ensureStarted();
          }
        });
      });
      resizeObserver.observe(host);
    }

    activateTerminalSurface();

    if (props.active) {
      await ensureStarted();
    }
  });

  createEffect(() => {
    if (!props.active) return;
    activateTerminalSurface();
  });

  onCleanup(() => {
    disposed = true;
    terminalEventsReady = false;
    pendingOutput.clear();
    const id = sessionId();
    if (id) {
      void invoke('terminal_stop', { id }).catch(() => {});
    }
    if (pendingFrame !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(pendingFrame);
    }
    dataDisposable?.dispose();
    resizeObserver?.disconnect();
    themeObserver?.disconnect();
    unlistenData?.();
    unlistenExit?.();
    unlistenError?.();
    terminal?.dispose();
  });

  const hostMessage = () => {
    const message = error();
    if (message) return message;
    if (starting()) return 'Starting shell...';
    if (running() && !hasOutput()) return 'Shell started. Waiting for output...';
    if (!running() && status() !== runningStatus) return status();
    return null;
  };

  return (
    <div class={styles.terminalPanel}>
      <div
        ref={host}
        class={styles.terminalHost}
        data-testid="terminal-host"
        onPointerDown={focusTerminal}
        onFocus={handleHostFocus}
        onKeyDown={handleHostKeyDown}
        tabIndex={0}
      >
        <div
          ref={xtermHost}
          class={styles.xtermMount}
          data-testid="xterm-mount"
          aria-hidden="true"
        />
        <Show when={hostMessage()}>
          {(message) => <div class={styles.hostStatus} role="status">{message()}</div>}
        </Show>
      </div>
      <Show when={error()}>
        {(message) => (
          <div class={styles.error} role="status">
            <span class={styles.errorText}>{message()}</span>
            <button
              type="button"
              class={styles.retryButton}
              onClick={retryTerminalStart}
              disabled={starting()}
            >
              Retry
            </button>
          </div>
        )}
      </Show>
    </div>
  );
};
