import type { HttpClient } from '../../http-client';
import type { ListResponse, McpServer, McpServerDesktop, McpServerDesktopPatch, McpTool } from '../../types';

export interface McpTransport {
  list(): Promise<ListResponse<McpServer>>;
  reload(): Promise<ListResponse<McpServer> & { ok: boolean; refreshed_agents?: number }>;
  add(server: McpServer): Promise<McpServer>;
  remove(name: string): Promise<{ ok: boolean }>;
  patchDesktop(name: string, patch: McpServerDesktopPatch): Promise<McpServerDesktop>;
  tools(name: string): Promise<{ items: McpTool[]; status?: Record<string, unknown> }>;
}

export function makeMcpTransport(c: HttpClient): McpTransport {
  return {
    list: () => c.get<ListResponse<McpServer>>('/desktop/api/mcp/servers'),
    reload: () => c.post<ListResponse<McpServer> & { ok: boolean; refreshed_agents?: number }>(
      '/desktop/api/mcp/reload',
      {},
    ),
    add: (server) => c.post<McpServer>('/desktop/api/mcp/servers', server),
    remove: (name) => c.delete<{ ok: boolean }>(`/desktop/api/mcp/servers/${encodeURIComponent(name)}`),
    patchDesktop: (name, patch) =>
      c.patch<McpServerDesktop>(`/desktop/api/mcp/servers/${encodeURIComponent(name)}/desktop`, patch),
    tools: (name) =>
      c.get<{ items: McpTool[]; status?: Record<string, unknown> }>(
        `/desktop/api/mcp/servers/${encodeURIComponent(name)}/tools`,
      ),
  };
}
