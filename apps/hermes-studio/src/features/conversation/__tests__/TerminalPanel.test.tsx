import { fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TerminalPanel } from '../TerminalPanel.js';

type TerminalEvent = 'terminal_data' | 'terminal_exit' | 'terminal_error';
type TerminalListener = (event: { payload: unknown }) => void;

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  isTauri: vi.fn(),
  listen: vi.fn(),
  listeners: new Map<string, TerminalListener[]>(),
  fitAddons: [] as Array<{
    fit: ReturnType<typeof vi.fn>;
  }>,
  webglAddons: [] as Array<{
    onContextLoss: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
  }>,
  terminalInstances: [] as Array<{
    cols: number;
    rows: number;
    options: { allowProposedApi?: boolean; theme: { background?: string } | null };
    focus: ReturnType<typeof vi.fn>;
    refresh: ReturnType<typeof vi.fn>;
    reset: ReturnType<typeof vi.fn>;
    write: ReturnType<typeof vi.fn>;
    open: ReturnType<typeof vi.fn>;
    emitData: (data: string) => void;
  }>,
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: mocks.invoke,
  isTauri: mocks.isTauri,
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: mocks.listen,
}));

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    constructor() {
      mocks.fitAddons.push(this);
    }

    fit = vi.fn(() => {
      const terminal = mocks.terminalInstances[mocks.terminalInstances.length - 1];
      if (!terminal) return;
      terminal.cols = 100;
      terminal.rows = 32;
    });
  },
}));

vi.mock('@xterm/addon-unicode11', () => ({
  Unicode11Addon: class {},
}));

vi.mock('@xterm/addon-web-links', () => ({
  WebLinksAddon: class {},
}));

vi.mock('@xterm/addon-webgl', () => ({
  WebglAddon: class {
    onContextLoss = vi.fn();
    dispose = vi.fn();

    constructor() {
      mocks.webglAddons.push(this);
    }
  },
}));

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    cols = 80;
    rows = 24;
    options: { allowProposedApi?: boolean; theme: { background?: string } | null } = { theme: null };
    unicode = { activeVersion: '' };
    focus = vi.fn();
    refresh = vi.fn();
    reset = vi.fn();
    write = vi.fn((_data: string | Uint8Array, callback?: () => void) => {
      callback?.();
    });
    dispose = vi.fn();
    loadAddon = vi.fn();
    open = vi.fn((host: HTMLElement) => {
      const element = document.createElement('div');
      element.className = 'xterm';
      element.setAttribute('data-testid', 'xterm-dom');
      host.appendChild(element);
    });
    private dataHandler: ((data: string) => void) | null = null;

    constructor(options?: { allowProposedApi?: boolean; theme?: { background?: string } }) {
      this.options.allowProposedApi = options?.allowProposedApi;
      this.options.theme = options?.theme ?? null;
      mocks.terminalInstances.push(this);
    }

    onData(handler: (data: string) => void) {
      this.dataHandler = handler;
      return { dispose: vi.fn() };
    }

    emitData(data: string) {
      this.dataHandler?.(data);
    }
  },
}));

let resizeCallback: ResizeObserverCallback | null = null;

class ResizeObserverMock {
  constructor(callback: ResizeObserverCallback) {
    resizeCallback = callback;
  }

  observe = vi.fn();
  disconnect = vi.fn();
}

function setHostSize(width: number, height: number) {
  const host = screen.getByTestId('terminal-host');
  Object.defineProperty(host, 'clientWidth', { configurable: true, value: width });
  Object.defineProperty(host, 'clientHeight', { configurable: true, value: height });
  resizeCallback?.([], {} as ResizeObserver);
}

function emitTerminalEvent(event: TerminalEvent, payload: unknown) {
  for (const listener of mocks.listeners.get(event) ?? []) {
    listener({ payload });
  }
}

function terminalStartCalls() {
  return mocks.invoke.mock.calls.filter(([command]) => command === 'terminal_start');
}

function renderTerminal(initialActive = true) {
  const [active, setActive] = createSignal(initialActive);
  const result = render(() => <TerminalPanel active={active()} cwd="/repo" />);
  return { setActive, unmount: result.unmount };
}

describe('TerminalPanel', () => {
  beforeEach(() => {
    let startSequence = 0;
    document.documentElement.removeAttribute('data-theme');
    resizeCallback = null;
    mocks.listeners.clear();
    mocks.fitAddons.length = 0;
    mocks.webglAddons.length = 0;
    mocks.terminalInstances.length = 0;
    mocks.isTauri.mockReturnValue(true);
    mocks.listen.mockImplementation(async (event: TerminalEvent, listener: TerminalListener) => {
      const listeners = mocks.listeners.get(event) ?? [];
      listeners.push(listener);
      mocks.listeners.set(event, listeners);
      return vi.fn();
    });
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === 'terminal_start') {
        startSequence += 1;
        return {
          id: `terminal-${startSequence}`,
          pid: 1234 + startSequence,
          shell: '/bin/zsh',
          cwd: '/repo',
          reused: false,
        };
      }
      return undefined;
    });
    vi.stubGlobal('ResizeObserver', ResizeObserverMock);
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => (
      window.setTimeout(() => callback(performance.now()), 0)
    ));
    vi.stubGlobal('cancelAnimationFrame', (id: number) => window.clearTimeout(id));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('waits for a measurable host before starting the PTY', async () => {
    renderTerminal(true);

    await waitFor(() => {
      expect(screen.getAllByText('Waiting for terminal layout...').length).toBeGreaterThan(0);
    });
    expect(terminalStartCalls()).toHaveLength(0);

    setHostSize(480, 320);

    await waitFor(() => {
      expect(terminalStartCalls()).toHaveLength(1);
    });
    expect(mocks.invoke).toHaveBeenCalledWith('terminal_start', {
      cwd: '/repo',
      cols: 100,
      rows: 32,
    });
    expect(screen.queryByRole('tab')).toBeNull();
    expect(screen.queryByText('repo')).toBeNull();
    expect(screen.queryByLabelText(/Terminal status:/)).toBeNull();
  });

  it('enables proposed xterm APIs required by the unicode addon', () => {
    renderTerminal(false);

    expect(mocks.terminalInstances[0]?.options.allowProposedApi).toBe(true);
  });

  // Regression: when allowProposedApi was false, Unicode11Addon's loadAddon
  // threw "You must set the allowProposedApi option to true" inside onMount,
  // rejecting the async mount before terminal.open(host) / the onData handler /
  // ensureStarted() ever ran — so the terminal rendered nothing: no cursor,
  // no input. This locks in that onMount runs to completion: open() is called
  // and, once the host is measurable, the PTY is started.
  it('mounts the xterm surface and starts the PTY once the host is measurable', async () => {
    renderTerminal(true);

    // open() runs synchronously inside onMount; if any addon threw we'd never
    // get here.
    expect(mocks.terminalInstances[0]?.open).toHaveBeenCalled();

    setHostSize(480, 320);

    await waitFor(() => {
      expect(terminalStartCalls()).toHaveLength(1);
    });
  });

  it('does not restart when switching away and back to Terminal', async () => {
    const { setActive } = renderTerminal(false);
    setHostSize(480, 320);

    setActive(true);
    await waitFor(() => {
      expect(terminalStartCalls()).toHaveLength(1);
    });

    setActive(false);
    setActive(true);

    await waitFor(() => {
      expect(mocks.terminalInstances[0]?.focus).toHaveBeenCalled();
    });
    expect(mocks.terminalInstances[0]?.refresh).toHaveBeenCalled();
    expect(terminalStartCalls()).toHaveLength(1);
  });

  it('coalesces terminal resize observer work through animation frames', async () => {
    const rafCallbacks: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
      rafCallbacks.push(callback);
      return rafCallbacks.length;
    }));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    mocks.isTauri.mockReturnValue(false);

    renderTerminal(false);
    const fitAddon = mocks.fitAddons[0];

    setHostSize(480, 320);
    setHostSize(500, 320);
    setHostSize(520, 320);

    expect(fitAddon?.fit).not.toHaveBeenCalled();
    expect(rafCallbacks).toHaveLength(1);

    rafCallbacks.shift()?.(performance.now());

    expect(fitAddon?.fit).toHaveBeenCalledTimes(1);

    setHostSize(540, 320);
    setHostSize(560, 320);

    expect(fitAddon?.fit).toHaveBeenCalledTimes(1);
    expect(rafCallbacks).toHaveLength(1);

    rafCallbacks.shift()?.(performance.now());

    expect(fitAddon?.fit).toHaveBeenCalledTimes(2);
  });

  it('does not render an internal tools dock close button', () => {
    renderTerminal(false);

    expect(screen.queryByRole('button', { name: /Close tools/i })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Back to tools' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'New terminal tab unavailable' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Restart terminal' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Stop terminal' })).toBeNull();
    expect(screen.queryByText('repo')).toBeNull();
  });

  it('shows a no-output state until terminal data arrives', async () => {
    const { setActive } = renderTerminal(false);
    setHostSize(480, 320);
    setActive(true);

    await waitFor(() => {
      expect(screen.getByText('Shell started. Waiting for output...')).toBeTruthy();
    });

    // The backend streams raw bytes (number[]); xterm receives a Uint8Array.
    // Multi-byte sequences must survive the hop without UTF-8 lossy decoding,
    // so assert on the exact bytes for a non-ASCII codepoint too.
    const promptBytes = Array.from(new TextEncoder().encode('$ 你好 '));
    emitTerminalEvent('terminal_data', { id: 'terminal-1', data: promptBytes });

    await waitFor(() => {
      const terminal = mocks.terminalInstances[mocks.terminalInstances.length - 1];
      expect(terminal?.write).toHaveBeenCalledWith(new Uint8Array(promptBytes), expect.any(Function));
    });
    expect(screen.queryByText('Shell started. Waiting for output...')).toBeNull();
  });

  it('keeps the imperatively mounted xterm DOM outside Solid status updates', async () => {
    const { setActive } = renderTerminal(false);
    setHostSize(480, 320);
    setActive(true);

    await waitFor(() => {
      expect(screen.getByText('Shell started. Waiting for output...')).toBeTruthy();
    });

    const mount = screen.getByTestId('xterm-mount');
    expect(mount.querySelector('.xterm')).not.toBeNull();

    const promptBytes = Array.from(new TextEncoder().encode('$ ready'));
    emitTerminalEvent('terminal_data', { id: 'terminal-1', data: promptBytes });

    await waitFor(() => {
      expect(screen.queryByText('Shell started. Waiting for output...')).toBeNull();
    });
    expect(screen.getByTestId('xterm-mount').querySelector('.xterm')).not.toBeNull();
    expect(screen.getByTestId('terminal-host').querySelector('.xterm')).not.toBeNull();
  });

  it('keeps waiting when terminal data contains only control sequences', async () => {
    const { setActive } = renderTerminal(false);
    setHostSize(480, 320);
    setActive(true);

    await waitFor(() => {
      expect(screen.getByText('Shell started. Waiting for output...')).toBeTruthy();
    });

    const controlBytes = Array.from(new TextEncoder().encode('\x1b[?2004h\r\n'));
    emitTerminalEvent('terminal_data', { id: 'terminal-1', data: controlBytes });

    await waitFor(() => {
      const terminal = mocks.terminalInstances[mocks.terminalInstances.length - 1];
      expect(terminal?.write).toHaveBeenCalledWith(new Uint8Array(controlBytes), expect.any(Function));
    });
    expect(screen.getByText('Shell started. Waiting for output...')).toBeTruthy();

    const promptBytes = Array.from(new TextEncoder().encode('$ '));
    emitTerminalEvent('terminal_data', { id: 'terminal-1', data: promptBytes });

    await waitFor(() => {
      expect(screen.queryByText('Shell started. Waiting for output...')).toBeNull();
    });
  });

  it('buffers terminal_data that arrives before terminal_start resolves', async () => {
    let resolveStart: (value: unknown) => void = () => {};
    mocks.invoke.mockImplementation((command: string) => {
      if (command === 'terminal_start') {
        return new Promise((resolve) => {
          resolveStart = resolve;
        });
      }
      return Promise.resolve(undefined);
    });

    renderTerminal(true);
    setHostSize(480, 320);

    await waitFor(() => {
      expect(terminalStartCalls()).toHaveLength(1);
    });

    const promptBytes = Array.from(new TextEncoder().encode('$ ready'));
    emitTerminalEvent('terminal_data', { id: 'terminal-early', data: promptBytes });

    const terminal = mocks.terminalInstances[mocks.terminalInstances.length - 1];
    expect(terminal?.write).not.toHaveBeenCalled();

    resolveStart({
      id: 'terminal-early',
      pid: 1234,
      shell: '/bin/zsh',
      cwd: '/repo',
      reused: false,
    });

    await waitFor(() => {
      expect(terminal?.write).toHaveBeenCalledWith(new Uint8Array(promptBytes), expect.any(Function));
    });
    expect(screen.queryByText('Shell started. Waiting for output...')).toBeNull();
  });

  it('marks output as running only after xterm write flushes', async () => {
    renderTerminal(true);
    setHostSize(480, 320);

    await waitFor(() => {
      expect(screen.getByText('Shell started. Waiting for output...')).toBeTruthy();
    });

    let flushWrite: (() => void) | undefined;
    const terminal = mocks.terminalInstances[mocks.terminalInstances.length - 1];
    terminal?.write.mockImplementationOnce((_data: string | Uint8Array, callback?: () => void) => {
      flushWrite = callback;
    });

    const promptBytes = Array.from(new TextEncoder().encode('$ '));
    emitTerminalEvent('terminal_data', { id: 'terminal-1', data: promptBytes });

    expect(screen.getByText('Shell started. Waiting for output...')).toBeTruthy();

    flushWrite?.();

    await waitFor(() => {
      expect(screen.queryByText('Shell started. Waiting for output...')).toBeNull();
    });
  });

  it('uses the DOM renderer in the Tauri desktop path', () => {
    renderTerminal(false);

    expect(mocks.webglAddons).toHaveLength(0);
  });

  it('focuses xterm when the terminal host is pressed', async () => {
    renderTerminal(true);
    expect(screen.getByTestId('terminal-host').getAttribute('tabindex')).toBe('0');
    const terminal = mocks.terminalInstances[mocks.terminalInstances.length - 1];
    terminal?.focus.mockClear();

    await fireEvent.pointerDown(screen.getByTestId('terminal-host'));

    expect(terminal?.focus).toHaveBeenCalledTimes(1);
  });

  it('stops the PTY when the terminal panel unmounts', async () => {
    const { unmount } = renderTerminal(true);
    setHostSize(480, 320);

    await waitFor(() => {
      expect(terminalStartCalls()).toHaveLength(1);
    });

    unmount();

    await waitFor(() => {
      expect(mocks.invoke).toHaveBeenCalledWith('terminal_stop', { id: 'terminal-1' });
    });
  });

  it('forwards keystrokes as raw bytes to terminal_write', async () => {
    renderTerminal(true);
    setHostSize(480, 320);

    await waitFor(() => {
      expect(terminalStartCalls()).toHaveLength(1);
    });

    const terminal = mocks.terminalInstances[mocks.terminalInstances.length - 1];
    terminal?.emitData('你好\r');

    const writeCalls = mocks.invoke.mock.calls.filter(([command]) => command === 'terminal_write');
    expect(writeCalls).toHaveLength(1);
    const [, payload] = writeCalls[0];
    expect(payload).toEqual({ id: 'terminal-1', data: Array.from(new TextEncoder().encode('你好\r')) });
  });

  it('falls back to host keydown forwarding when xterm textarea does not receive focus', async () => {
    renderTerminal(true);
    setHostSize(480, 320);

    await waitFor(() => {
      expect(terminalStartCalls()).toHaveLength(1);
    });

    const host = screen.getByTestId('terminal-host');
    await fireEvent.keyDown(host, { key: 'a' });
    await fireEvent.keyDown(host, { key: 'Enter' });
    await fireEvent.keyDown(host, { key: 'c', ctrlKey: true });

    await waitFor(() => {
      expect(mocks.invoke.mock.calls.filter(([command]) => command === 'terminal_write')).toHaveLength(3);
    });
    const writeCalls = mocks.invoke.mock.calls.filter(([command]) => command === 'terminal_write');
    expect(writeCalls[0][1]).toEqual({ id: 'terminal-1', data: Array.from(new TextEncoder().encode('a')) });
    expect(writeCalls[1][1]).toEqual({ id: 'terminal-1', data: Array.from(new TextEncoder().encode('\r')) });
    expect(writeCalls[2][1]).toEqual({ id: 'terminal-1', data: [3] });
  });

  it('adapts the xterm theme to the desktop theme', async () => {
    renderTerminal(true);

    await waitFor(() => {
      expect(mocks.terminalInstances[0]?.options.theme?.background).toBe('#fbfcff');
    });

    document.documentElement.dataset.theme = 'dark';

    await waitFor(() => {
      expect(mocks.terminalInstances[0]?.options.theme?.background).toBe('#0a0c10');
    });
  });

  // Regression: a persistent terminal_start failure never sets a sessionId, so
  // the auto-start guard kept passing and the .error banner toggling the host
  // height re-fired the ResizeObserver -> ensureStarted -> setError loop,
  // flashing the message endlessly and hammering the backend. A start failure
  // must latch so auto-start does not retry on subsequent layout ticks.
  const PTY_START_ERROR = 'Terminal failed to start: pseudo-terminal allocation failed';

  it('stops retrying terminal_start after a start failure (no flash loop)', async () => {
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === 'terminal_start') throw PTY_START_ERROR;
      return undefined;
    });

    renderTerminal(true);
    setHostSize(480, 320);

    await waitFor(() => {
      expect(terminalStartCalls()).toHaveLength(1);
    });
    await waitFor(() => {
      expect(screen.getAllByText(PTY_START_ERROR).length).toBeGreaterThan(0);
    });

    // Simulate the layout churn the real ResizeObserver produces when the error
    // banner toggles the host height. Must NOT trigger another start attempt.
    setHostSize(500, 320);
    await new Promise((resolve) => setTimeout(resolve, 10));
    setHostSize(520, 320);
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(terminalStartCalls()).toHaveLength(1);
    // Message stays rendered (stable, not cleared/flickering).
    expect(screen.getAllByText(PTY_START_ERROR).length).toBeGreaterThan(0);
  });

  it('retries terminal_start only after the user clicks Retry', async () => {
    let startAttempts = 0;
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === 'terminal_start') {
        startAttempts += 1;
        if (startAttempts === 1) throw PTY_START_ERROR;
        return {
          id: 'terminal-retry',
          pid: 1234,
          shell: '/bin/zsh',
          cwd: '/repo',
          reused: false,
        };
      }
      return undefined;
    });

    renderTerminal(true);
    setHostSize(480, 320);

    await waitFor(() => {
      expect(terminalStartCalls()).toHaveLength(1);
    });
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();

    setHostSize(520, 320);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(terminalStartCalls()).toHaveLength(1);

    await fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => {
      expect(terminalStartCalls()).toHaveLength(2);
    });
    await waitFor(() => {
      expect(screen.queryByText(PTY_START_ERROR)).toBeNull();
    });
  });
});
