import type { HttpClient } from '../../http-client';
import type {
  ActiveProfileResponse,
  ProfileCreateRequest,
  ProfileInfo,
  ProfilesResponse,
  ProfileSessionsResponse,
  ProfileUpdateRequest,
} from '../../types';
import type { SessionListItem } from '@/types/session';

export interface ProfilesTransport {
  list(): Promise<ProfilesResponse>;
  active(): Promise<ActiveProfileResponse>;
  setActive(profileId: string): Promise<ActiveProfileResponse & { ok: boolean }>;
  create(input: ProfileCreateRequest): Promise<{ profile: ProfileInfo }>;
  update(profileId: string, input: ProfileUpdateRequest): Promise<{ profile: ProfileInfo }>;
  remove(profileId: string): Promise<{ ok: boolean }>;
  getState<T = unknown>(profileId: string, key: string): Promise<{ value: T | null }>;
  setState(profileId: string, key: string, value: unknown): Promise<{ ok: boolean }>;
  sessions(profile: 'current' | 'all' | string, archived?: 'exclude' | 'include' | 'only'): Promise<ProfileSessionsResponse<SessionListItem>>;
}

export function makeProfilesTransport(c: HttpClient): ProfilesTransport {
  return {
    list: () => c.get<ProfilesResponse>('/desktop/api/profiles'),
    active: () => c.get<ActiveProfileResponse>('/desktop/api/profiles/active'),
    setActive: (profileId) => c.put<ActiveProfileResponse & { ok: boolean }>(
      '/desktop/api/profiles/active',
      { profileId },
    ),
    create: (input) => c.post<{ profile: ProfileInfo }>('/desktop/api/profiles', input),
    update: (profileId, input) => c.patch<{ profile: ProfileInfo }>(
      `/desktop/api/profiles/${encodeURIComponent(profileId)}`,
      input,
    ),
    remove: (profileId) => c.delete<{ ok: boolean }>(
      `/desktop/api/profiles/${encodeURIComponent(profileId)}`,
    ),
    getState: <T = unknown>(profileId: string, key: string) => c.get<{ value: T | null }>(
      `/desktop/api/profiles/${encodeURIComponent(profileId)}/state/${encodeURIComponent(key)}`,
    ),
    setState: (profileId, key, value) => c.put<{ ok: boolean }>(
      `/desktop/api/profiles/${encodeURIComponent(profileId)}/state/${encodeURIComponent(key)}`,
      { value },
    ),
    sessions: (profile, archived = 'exclude') => c.get<ProfileSessionsResponse<SessionListItem>>(
      `/desktop/api/profiles/sessions?profile=${encodeURIComponent(profile)}&archived=${archived}`,
    ),
  };
}
