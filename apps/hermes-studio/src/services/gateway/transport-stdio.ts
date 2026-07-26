/**
 * Stdio transport — spawns a Python child process and communicates
 * via NDJSON over stdin/stdout.
 *
 * Callers: transport.ts (re-export), integration tests
 * No existing equivalent — transport.ts only has a placeholder stub.
 * No data files read/written.
 */

import { spawn, type ChildProcess } from 'child_process';
import { BaseJsonRpcTransport } from './transport-base.js';
import type { Transport } from './transport.js';

export interface StdioTransportOptions {
  pythonPath?: string;
  gatewayModule?: string;
  cwd?: string;
  env?: Record<string, string>;
  args?: string[];
}

export class StdioTransport extends BaseJsonRpcTransport implements Transport {
  private process: ChildProcess | null = null;
  private options: StdioTransportOptions;

  constructor(options: StdioTransportOptions = {}) {
    super();
    this.options = options;
  }

  connect(): void {
    const pythonPath = this.options.pythonPath ?? 'python3';
    const gatewayModule = this.options.gatewayModule ?? 'tui_gateway.entry';
    const args = ['-m', gatewayModule, ...(this.options.args ?? [])];

    this.process = spawn(pythonPath, args, {
      cwd: this.options.cwd,
      env: { ...process.env, ...this.options.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.process.stdout!.on('data', (chunk: Buffer) => {
      this.handleData(chunk.toString('utf-8'));
    });

    this.process.stderr!.on('data', () => {
      // Gateway stderr diagnostics
    });

    this.process.on('close', () => {
      this.onClose();
    });

    this.process.on('error', () => {
      this.onClose();
    });
  }

  protected writeLine(line: string): void {
    if (this.process && this.process.stdin && !this.process.stdin.destroyed) {
      this.process.stdin.write(line + '\n');
    }
  }

  close(): void {
    if (this.process) {
      this.process.stdin?.end();
      this.process.kill('SIGTERM');
      this.process = null;
    }
    this.onClose();
  }
}
