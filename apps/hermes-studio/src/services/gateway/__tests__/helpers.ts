/**
 * Test helpers for gateway integration tests.
 * Spawns a real Python tui_gateway process with UDS transport.
 */

import { spawn, type ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';

const GATEWAY_START_TIMEOUT_MS = 15_000;
const SOCKET_POLL_INTERVAL_MS = 100;

export interface GatewayFixture {
  process: ChildProcess;
  socketPath: string;
  homePath: string;
  sendRequest(method: string, params?: Record<string, unknown>): Promise<unknown>;
  cleanup(): Promise<void>;
}

function resolvePython(): string {
  const configured = process.env.HERMES_PYTHON?.trim() || process.env.PYTHON?.trim();
  if (configured) return configured;

  const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..', '..', '..');
  const venv = process.env.VIRTUAL_ENV?.trim();

  const candidates = [
    venv && path.resolve(venv, 'bin/python'),
    venv && path.resolve(venv, 'Scripts/python.exe'),
    path.resolve(repoRoot, '.venv/bin/python'),
    path.resolve(repoRoot, '.venv/bin/python3'),
    path.resolve(repoRoot, 'venv/bin/python'),
    path.resolve(repoRoot, 'venv/bin/python3'),
    path.resolve(os.homedir(), '.hermes/hermes-agent/venv/bin/python3'),
    path.resolve(os.homedir(), '.hermes/hermes-agent/venv/bin/python'),
  ].filter(Boolean) as string[];

  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return process.platform === 'win32' ? 'python' : 'python3';
}

export async function spawnGateway(extraEnv: Record<string, string> = {}): Promise<GatewayFixture> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-gateway-test-'));
  const homePath = path.join(tmpDir, 'home');
  const runDir = path.join(homePath, 'run');
  const socketPath = path.join(runDir, 'gateway.sock');
  fs.mkdirSync(runDir, { recursive: true });

  // Minimal synthetic config so gateway doesn't crash on load
  const configYaml = `model: anthropic/claude-sonnet-4
display:
  skin: default
  theme: dark
`;
  fs.writeFileSync(path.join(homePath, 'config.yaml'), configYaml);

  const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..', '..', '..');
  const python = resolvePython();

  const proc = spawn(python, [
    '-m', 'tui_gateway.entry',
    '--transport', 'unix_socket',
    '--socket', socketPath,
  ], {
    cwd: repoRoot,
    env: {
      ...process.env,
      HERMES_HOME: homePath,
      PYTHONUNBUFFERED: '1',
      PYTHONPATH: `${repoRoot}${path.delimiter}${process.env.PYTHONPATH || ''}`,
      ...extraEnv,
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  await waitForSocket(socketPath, GATEWAY_START_TIMEOUT_MS);

  const socket = net.createConnection(socketPath);

  await new Promise<void>((resolve, reject) => {
    socket.on('connect', resolve);
    socket.on('error', reject);
    setTimeout(() => reject(new Error('Socket connect timeout')), 5000);
  });

  let readBuffer = '';

  const readyPromise = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('gateway.ready timeout')), 5000);

    function onData(chunk: Buffer) {
      readBuffer += chunk.toString('utf-8');
      const lines = readBuffer.split('\n');
      readBuffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.method === 'event' && msg.params?.type === 'gateway.ready') {
            clearTimeout(timer);
            socket.off('data', onData);
            resolve();
            return;
          }
        } catch { /* ignore malformed */ }
      }
    }
    socket.on('data', onData);
  });

  await readyPromise;

  let nextId = 1;
  const pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

  socket.on('data', (chunk: Buffer) => {
    readBuffer += chunk.toString('utf-8');
    const lines = readBuffer.split('\n');
    readBuffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.id != null) {
          const cb = pending.get(String(msg.id));
          if (cb) {
            pending.delete(String(msg.id));
            if (msg.error) {
              cb.reject(new Error(msg.error.message ?? 'JSON-RPC error'));
            } else {
              cb.resolve(msg.result);
            }
          }
        }
      } catch { /* ignore */ }
    }
  });

  socket.on('close', () => {
    for (const cb of pending.values()) {
      cb.reject(new Error('Socket closed'));
    }
    pending.clear();
  });

  const sendRequest = (method: string, params?: Record<string, unknown>): Promise<unknown> => {
    const id = String(nextId++);
    const request = JSON.stringify({ jsonrpc: '2.0', id, method, params: params ?? {} });
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      if (socket.destroyed) {
        pending.delete(id);
        reject(new Error('Socket destroyed'));
        return;
      }
      socket.write(request + '\n', (err) => {
        if (err) {
          pending.delete(id);
          reject(err);
        }
      });
    });
  };

  const cleanup = async (): Promise<void> => {
    for (const cb of pending.values()) {
      cb.reject(new Error('Test cleanup'));
    }
    pending.clear();
    socket.destroy();
    proc.kill('SIGTERM');
    await new Promise<void>((resolve) => {
      proc.on('close', () => resolve());
      setTimeout(resolve, 3000);
    });
    try { fs.unlinkSync(socketPath); } catch { /* ok */ }
    try { fs.rmSync(tmpDir, { recursive: true }); } catch { /* ok */ }
  };

  return { process: proc, socketPath, homePath, sendRequest, cleanup };
}

async function waitForSocket(socketPath: string, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      fs.accessSync(socketPath, fs.constants.R_OK | fs.constants.W_OK);
      return;
    } catch {
      await new Promise(r => setTimeout(r, SOCKET_POLL_INTERVAL_MS));
    }
  }
  throw new Error(`Socket not ready after ${timeoutMs}ms: ${socketPath}`);
}
