/**
 * Base class for JSON-RPC 2.0 transports.
 *
 * Handles request/response matching by id, notification routing,
 * error extraction, and timeout management.
 */

import type { Transport } from './transport.js';

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** Default timeout for JSON-RPC requests (30s). */
export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

export abstract class BaseJsonRpcTransport implements Transport {
  private pending = new Map<string, PendingRequest>();
  private nextId = 1;
  private messageHandler: ((event: Record<string, unknown>) => void) | null = null;
  private readBuffer = '';
  private disposed = false;

  onMessage(handler: (event: Record<string, unknown>) => void): void {
    this.messageHandler = handler;
  }

  send(method: string, params?: Record<string, unknown>): Promise<unknown> {
    if (this.disposed) {
      return Promise.reject(new Error('Transport is closed'));
    }
    const id = String(this.nextId++);
    const request = JSON.stringify({
      jsonrpc: '2.0',
      id,
      method,
      params: params ?? {},
    });
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`JSON-RPC request timeout: ${method} (id=${id})`));
      }, DEFAULT_REQUEST_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
      this.writeLine(request);
    });
  }

  abstract close(): void;

  /** Subclasses call this with each line received from the wire. */
  protected writeLine(_line: string): void {
    // Implemented by subclasses
  }

  /** Subclasses must call this when data arrives from the wire. */
  protected handleData(chunk: string): void {
    if (this.disposed) return;
    this.readBuffer += chunk;
    const lines = this.readBuffer.split('\n');
    this.readBuffer = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      this.handleLine(trimmed);
    }
  }

  /** Subclasses must call this when the connection closes. */
  protected onClose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Transport closed'));
    }
    this.pending.clear();
  }

  private handleLine(line: string): void {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }

    const id = msg.id as string | number | undefined | null;

    if (id !== undefined && id !== null) {
      // Response to a pending request
      const key = String(id);
      const pending = this.pending.get(key);
      if (pending) {
        clearTimeout(pending.timer);
        this.pending.delete(key);
        if (msg.error !== undefined && msg.error !== null) {
          const err = msg.error as { message?: string; code?: number };
          pending.reject(new Error(err.message ?? `JSON-RPC error ${err.code ?? ''}`));
        } else {
          pending.resolve(msg.result);
        }
      }
    } else {
      // Notification (no id)
      if (msg.method === 'event' && this.messageHandler) {
        const params = msg.params as Record<string, unknown> | undefined;
        if (params && typeof params.type === 'string') {
          this.messageHandler({
            type: params.type,
            session_id: params.session_id,
            payload: params.payload,
          });
        }
      }
    }
  }
}
