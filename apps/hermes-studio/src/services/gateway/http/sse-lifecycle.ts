import type { HttpClient } from '@/services/api/http-client.js';
import { API_PREFIX } from './shared.js';

export async function resolveEventSourceUrl(http: HttpClient): Promise<string> {
  const info = await http.backendInfo();
  return `${info.base_url}${API_PREFIX}/events/stream?token=${encodeURIComponent(info.token)}`;
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
