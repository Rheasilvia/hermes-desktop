/**
 * Unix Domain Socket (UDS) transport for Desktop gateway connections.
 *
 * Callers: transport.ts (re-export), integration tests (spawnGateway helper).
 * No existing equivalent — no socket transport exists in the project.
 * No data files read/written; connects via Node.js net module to UDS sockets.
 */

import * as net from 'net';
import { BaseJsonRpcTransport } from './transport-base.js';
import type { Transport } from './transport.js';

export class UnixSocketTransport extends BaseJsonRpcTransport implements Transport {
  private socket: net.Socket | null = null;
  private socketPath: string;

  constructor(socketPath: string) {
    super();
    this.socketPath = socketPath;
  }

  /** Connect to the UDS socket. Returns a Promise that resolves on connect. */
  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket = net.createConnection(this.socketPath, () => {
        resolve();
      });

      this.socket.on('data', (chunk: Buffer) => {
        this.handleData(chunk.toString('utf-8'));
      });

      this.socket.on('close', () => {
        this.onClose();
      });

      this.socket.on('error', (err: Error) => {
        reject(err);
      });
    });
  }

  protected writeLine(line: string): void {
    if (this.socket && !this.socket.destroyed) {
      this.socket.write(line + '\n');
    }
  }

  close(): void {
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
    this.onClose();
  }
}
