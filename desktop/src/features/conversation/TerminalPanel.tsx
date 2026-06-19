import { invoke, isTauri } from '@tauri-apps/api/core';
import { FitAddon } from '@xterm/addon-fit';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { WebglAddon } from '@xterm/addon-webgl';
import { Terminal as XTerm, type ITheme } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import type { Component } from 'solid-js';
import { Show, createEffect, createSignal, onCleanup, onMount } from 'solid-js';
import { Icon } from '@/ui/atoms/Icon.js';
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

export const TerminalPanel: Component<TerminalPanelProps> = (props) => {
  let host: HTMLDivElement | undefined;
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
  let runningStatus = 'Terminal running';

  const [sessionId, setSessionId] = createSignal<string | null>(null);
  const [starting, setStarting] = createSignal(false);
  const [running, setRunning] = createSignal(false);
  const [status, setStatus] = createSignal('Terminal idle');
  const [error, setError] = createSignal<string | null>(null);
  const [hasOutput, setHasOutput] = createSignal(false);

  const resolveThemeName = (): TerminalThemeName => {
    if (typeof document === 'undefined') return 'light';
    const theme = document.documentElement.dataset.theme;
    return theme === 'dark' || theme === 'earth' ? theme : 'light';
  };

  const applyTerminalTheme = () => {
    if (!terminal) return;
    terminal.options.theme = terminalThemes[resolveThemeName()];
  };

  const workspaceTitle = () => {
    const cwd = props.cwd?.trim();
    if (!cwd) return 'Terminal';
    const normalized = cwd.replace(/[\\/]+$/, '');
    const name = normalized.split(/[\\/]/).filter(Boolean).pop();
    return name ? name : 'Terminal';
  };

  const statusTone = () => {
    if (error()) return 'error';
    if (starting()) return 'starting';
    if (running()) return hasOutput() ? 'running' : 'waiting';
    if (status() === 'Terminal stopped') return 'stopped';
    return 'idle';
  };

  const compactStatus = () => {
    switch (statusTone()) {
      case 'error':
        return 'Error';
      case 'starting':
        return 'Starting';
      case 'running':
        return 'Running';
      case 'waiting':
        return 'Waiting';
      case 'stopped':
        return 'Stopped';
      default:
        return 'Idle';
    }
  };

  const hostIsReady = () => {
    if (!host) return false;
    return host.clientWidth > 0 && host.clientHeight > 0;
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
    if (options.focus && props.active) {
      terminal.focus();
    }
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
    if (sessionId() || starting()) return;
    if (!terminal) return;
    if (!isTauri()) {
      setStatus('Terminal is available in the desktop app.');
      return;
    }
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
      runningStatus = `${result.reused ? 'Attached' : 'Running'} ${result.shell} in ${result.cwd}`;
      setSessionId(result.id);
      setRunning(true);
      setStatus(runningStatus);
      fitAndResize({ focus: true, refresh: true });
    } catch (err) {
      setError(String(err));
      setStatus('Terminal failed to start');
    } finally {
      setStarting(false);
    }
  };

  const stopTerminal = async () => {
    const id = sessionId();
    if (!id) return;
    try {
      await invoke('terminal_stop', { id });
      setRunning(false);
      setSessionId(null);
      setHasOutput(false);
      setError(null);
      setStatus('Terminal stopped');
    } catch (err) {
      setError(String(err));
    }
  };

  const restartTerminal = async () => {
    await stopTerminal();
    terminal?.reset();
    setSessionId(null);
    setHasOutput(false);
    setError(null);
    await ensureStarted();
  };

  onMount(async () => {
    if (!host) return;
    terminal = new XTerm({
      allowProposedApi: true,
      convertEol: true,
      cursorBlink: true,
      cursorStyle: 'block',
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
      fontSize: 12,
      lineHeight: 1.2,
      scrollback: 5000,
      theme: terminalThemes[resolveThemeName()],
    });
    fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.loadAddon(new WebLinksAddon());
    terminal.loadAddon(new Unicode11Addon());
    terminal.unicode.activeVersion = '11';
    terminal.open(host);
    // WebGL renderer matches the dashboard + Electron paths; xterm's default
    // DOM renderer paints SGR via CSS classes that visibly mute against our
    // skins. Load after open() (needs a mounted canvas); fall back silently.
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
    if (typeof MutationObserver !== 'undefined') {
      themeObserver = new MutationObserver(applyTerminalTheme);
      themeObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['data-theme'],
      });
    }
    activateTerminalSurface();

    dataDisposable = terminal.onData((data) => {
      const id = sessionId();
      if (!id || !running()) return;
      // xterm hands us a string; the PTY backend takes raw bytes so non-UTF-8
      // key sequences round-trip correctly. Encode once and forward.
      if (!textEncoder) textEncoder = new TextEncoder();
      const bytes = Array.from(textEncoder.encode(data));
      void invoke('terminal_write', { id, data: bytes }).catch((err) => setError(String(err)));
    });

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

    if (isTauri()) {
      const { listen } = await import('@tauri-apps/api/event');
      unlistenData = await listen<TerminalDataEvent>('terminal_data', (event) => {
        const current = sessionId();
        if (!current || event.payload.id !== current) return;
        setHasOutput(true);
        setStatus(runningStatus);
        terminal?.write(new Uint8Array(event.payload.data));
      });
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
      unlistenError = await listen<TerminalErrorEvent>('terminal_error', (event) => {
        const current = sessionId();
        if (!current || event.payload.id !== current) return;
        setError(event.payload.error);
        setStatus('Terminal error');
      });
    }

    if (props.active) {
      await ensureStarted();
    }
  });

  createEffect(() => {
    if (!props.active) return;
    activateTerminalSurface();
  });

  onCleanup(() => {
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
      <div class={styles.terminalHeader}>
        <div
          class={styles.terminalTitle}
          title={props.cwd ?? workspaceTitle()}
        >
          <Icon name="terminal" size={15} />
          <span class={styles.terminalTitleText}>{workspaceTitle()}</span>
        </div>
        <div class={styles.headerActions}>
          <div
            class={styles.statusPill}
            classList={{
              [styles.statusRunning]: statusTone() === 'running',
              [styles.statusWaiting]: statusTone() === 'waiting' || statusTone() === 'starting',
              [styles.statusStopped]: statusTone() === 'stopped' || statusTone() === 'idle',
              [styles.statusError]: statusTone() === 'error',
            }}
            title={status()}
            aria-label={`Terminal status: ${status()}`}
          >
            <span class={styles.statusDot} aria-hidden="true" />
            {compactStatus()}
          </div>
          <button
            type="button"
            class={styles.actionButton}
            onClick={() => void restartTerminal()}
            title="Restart terminal"
            aria-label="Restart terminal"
            disabled={starting()}
          >
            <Icon name="refresh-cw" size={14} />
          </button>
          <button
            type="button"
            class={styles.actionButton}
            onClick={() => void stopTerminal()}
            title="Stop terminal"
            aria-label="Stop terminal"
            disabled={!sessionId() || starting()}
          >
            <Icon name="square" size={13} />
          </button>
        </div>
      </div>
      <div ref={host} class={styles.terminalHost} data-testid="terminal-host">
        <Show when={hostMessage()}>
          {(message) => <div class={styles.hostStatus} role="status">{message()}</div>}
        </Show>
      </div>
      <Show when={error()}>
        {(message) => <div class={styles.error} role="status">{message()}</div>}
      </Show>
    </div>
  );
};
