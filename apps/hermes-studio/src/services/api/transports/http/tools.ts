import type { HttpClient } from '../../http-client';
import type { ToolInfo } from '../../types';

export interface ToolsTransport {
  list(): Promise<{ items: ToolInfo[] }>;
  reload(): Promise<{ items: ToolInfo[] }>;
}

export function makeToolsTransport(c: HttpClient): ToolsTransport {
  return {
    list: () => c.get<{ items: ToolInfo[] }>('/desktop/api/tools'),
    reload: () => c.post<{ items: ToolInfo[] }>('/desktop/api/tools/reload', {}),
  };
}
