import { httpClient, type HttpClient } from './http-client.js';

const API_PREFIX = '/desktop/api';

export interface DesktopState {
  schema_version: number;
  last_open_route: string;
  last_session_id: string | null;
  last_cwd: string | null;
  window: { w: number; h: number };
}

export async function loadState(client: HttpClient = httpClient): Promise<DesktopState> {
  return client.get<DesktopState>(`${API_PREFIX}/state`);
}

export async function saveState(
  state: Partial<DesktopState>,
  client: HttpClient = httpClient,
): Promise<DesktopState> {
  return client.put<DesktopState>(`${API_PREFIX}/state`, state);
}
