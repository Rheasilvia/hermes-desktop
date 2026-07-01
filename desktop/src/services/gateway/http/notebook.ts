import type { HttpClient } from '@/services/api/http-client.js';
import type { GatewayAdapter, NotebookMethods, NotebookRender } from '../types.js';
import { API_PREFIX } from './shared.js';

export function makeNotebookGateway(http: HttpClient): GatewayAdapter['notebook'] {
  const notebook: NotebookMethods = {
    render: async (sessionId: string, path: string): Promise<NotebookRender> =>
      http.get<NotebookRender>(
        `${API_PREFIX}/sessions/${encodeURIComponent(sessionId)}/notebook/render?path=${encodeURIComponent(path)}`,
      ),
    watch: async (sessionId: string, path: string) =>
      http.post<{ ok: boolean; path?: string | null }>(
        `${API_PREFIX}/sessions/${encodeURIComponent(sessionId)}/notebook/watch`,
        { path },
      ),
    clearWatch: async (sessionId: string) =>
      http.delete<{ ok: boolean }>(
        `${API_PREFIX}/sessions/${encodeURIComponent(sessionId)}/notebook/watch`,
      ),
  };
  return notebook;
}
