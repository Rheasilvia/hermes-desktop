/**
 * Abstract transport interface and implementations.
 */

export interface Transport {
  send(method: string, params?: Record<string, unknown>): Promise<unknown>;
  onMessage(handler: (event: Record<string, unknown>) => void): void;
  close(): void;
}

export interface StdioTransportOptions {
  pythonPath?: string;
  cwd?: string;
}

export class StdioTransportPlaceholder implements Transport {
  private disposed = false;

  send(_method: string, _params?: Record<string, unknown>): Promise<unknown> {
    if (this.disposed) {
      return Promise.reject(new Error('Transport is closed'));
    }
    return Promise.reject(new Error('StdioTransportPlaceholder: not implemented'));
  }

  onMessage(_handler: (event: Record<string, unknown>) => void): void {
    // placeholder — no-op
  }

  close(): void {
    this.disposed = true;
  }
}

export { BaseJsonRpcTransport, DEFAULT_REQUEST_TIMEOUT_MS } from './transport-base.js';
export { StdioTransport } from './transport-stdio.js';
export { UnixSocketTransport } from './transport-socket.js';
export type { StdioTransportOptions as RealStdioTransportOptions } from './transport-stdio.js';
