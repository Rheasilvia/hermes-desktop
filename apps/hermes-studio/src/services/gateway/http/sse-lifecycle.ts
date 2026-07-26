import type { HttpClient } from '@/services/api/http-client.js';
import { API_PREFIX } from './shared.js';

export async function resolveEventSourceUrl(http: HttpClient): Promise<string> {
  try {
    const info = await (http as unknown as { info: () => Promise<{ base_url: string; token: string }> }).info?.();
    if (info) {
      return `${info.base_url}${API_PREFIX}/events/stream?token=${encodeURIComponent(info.token)}`;
    }
  } catch {
    // Fall through to Vite env fallback below.
  }
  const baseUrl = import.meta.env.VITE_SIDECAR_URL ?? 'http://127.0.0.1:18080';
  const token = import.meta.env.VITE_SIDECAR_TOKEN ?? '';
  return `${baseUrl}${API_PREFIX}/events/stream?token=${encodeURIComponent(token)}`;
}

export async function openEventSource(
  url: string,
  callbacks: {
    onMessage(data: unknown): void;
    onError(): void;
    onOpen(): void;
  },
): Promise<EventSource> {
  const eventSource = new EventSource(url);
  eventSource.onmessage = (e: MessageEvent) => {
    try {
      callbacks.onMessage(JSON.parse(e.data));
    } catch {
      // Ignore keepalives and malformed frames.
    }
  };
  eventSource.onerror = callbacks.onError;

  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, 5_000);
    eventSource.onopen = () => {
      clearTimeout(timer);
      callbacks.onOpen();
      resolve();
    };
  });

  return eventSource;
}
