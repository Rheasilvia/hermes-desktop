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
  terminalInstances: [] as Array<{
    cols: number;
    rows: number;
    options: { theme: { background?: string } | null };
    focus: ReturnType<typeof vi.fn>;
    refresh: ReturnType<typeof vi.fn>;
    reset: ReturnType<typeof vi.fn>;
    write: ReturnType<typeof vi.fn>;
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

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    cols = 80;
    rows = 24;
    options: { theme: { background?: string } | null } = { theme: null };
    unicode = { activeVersion: '' };
    focus = vi.fn();
    refresh = vi.fn();
    reset = vi.fn();
    write = vi.fn();
    dispose = vi.fn();
    loadAddon = vi.fn();
    open = vi.fn();
    private dataHandler: ((data: string) => void) | null = null;

    constructor(options?: { theme?: { background?: string } }) {
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
  render(() => <TerminalPanel active={active()} cwd="/repo" />);
  return { setActive };
}

describe('TerminalPanel', () => {
  beforeEach(() => {
    let startSequence = 0;
    document.documentElement.removeAttribute('data-theme');
    resizeCallback = null;
    mocks.listeners.clear();
    mocks.fitAddons.length = 0;
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
    expect(screen.getByText('repo')).toBeTruthy();
    expect(screen.queryByRole('tab')).toBeNull();
    expect(screen.getByLabelText('Terminal status: Running /bin/zsh in /repo')).toBeTruthy();
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
  });

  it('shows a no-output state until terminal data arrives', async () => {
    const { setActive } = renderTerminal(false);
    setHostSize(480, 320);
    setActive(true);

    await waitFor(() => {
      expect(screen.getByText('Shell started. Waiting for output...')).toBeTruthy();
    });

    emitTerminalEvent('terminal_data', { id: 'terminal-1', data: '$ ' });

    await waitFor(() => {
      const terminal = mocks.terminalInstances[mocks.terminalInstances.length - 1];
      expect(terminal?.write).toHaveBeenCalledWith('$ ');
    });
    expect(screen.queryByText('Shell started. Waiting for output...')).toBeNull();
    expect(screen.getByText('Running')).toBeTruthy();
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

  it('stops and restarts the PTY explicitly', async () => {
    renderTerminal(true);
    setHostSize(480, 320);

    const restartButton = screen.getByRole('button', { name: 'Restart terminal' });
    const stopButton = screen.getByRole('button', { name: 'Stop terminal' });

    await waitFor(() => {
      expect(terminalStartCalls()).toHaveLength(1);
    });

    fireEvent.click(stopButton);

    await waitFor(() => {
      expect(mocks.invoke).toHaveBeenCalledWith('terminal_stop', { id: 'terminal-1' });
    });
    expect(screen.getAllByText('Terminal stopped').length).toBeGreaterThan(0);

    fireEvent.click(restartButton);

    await waitFor(() => {
      expect(terminalStartCalls()).toHaveLength(2);
    });
    expect(mocks.terminalInstances[0]?.reset).toHaveBeenCalled();
  });
});
