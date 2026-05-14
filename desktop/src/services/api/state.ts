const API_PREFIX = '/desktop/api';

interface DesktopState {
  schema_version: number;
  last_open_route: string;
  last_session_id: string | null;
  last_workspace_path: string | null;
  window: { w: number; h: number };
}

export async function loadState(token?: string): Promise<DesktopState> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${API_PREFIX}/state`, { headers });
  if (!res.ok) throw new Error(`Failed to load state: ${res.status}`);
  return res.json();
}

export async function saveState(
  state: Partial<DesktopState>,
  token?: string,
): Promise<DesktopState> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${API_PREFIX}/state`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(state),
  });
  if (!res.ok) throw new Error(`Failed to save state: ${res.status}`);
  return res.json();
}
