import { createMemo, createSignal } from 'solid-js';
import { api, type ProfileCreateRequest, type ProfileInfo, type ProfileUpdateRequest } from '@/services/api';
import { chatStore } from './chat';
import { configStore } from './config';
import { sessionStore } from './session';

const ALL_PROFILES = '__all__';
const LAST_SESSION_KEY = 'last_session_id';

export class ProfileSwitchBlockedError extends Error {
  constructor(readonly sessionId: string) {
    super('Current session has a running or pending turn');
    this.name = 'ProfileSwitchBlockedError';
  }
}

const [profiles, setProfiles] = createSignal<ProfileInfo[]>([]);
const [activeProfileId, setActiveProfileId] = createSignal('default');
const [showAllProfiles, setShowAllProfiles] = createSignal(false);
const [isLoading, setIsLoading] = createSignal(false);
const [error, setError] = createSignal<string | null>(null);

const activeProfile = createMemo(() =>
  profiles().find((profile) => profile.id === activeProfileId()) ?? null,
);

const profileScope = createMemo(() => showAllProfiles() ? ALL_PROFILES : activeProfileId());

function isSwitchBlocked(): string | null {
  const sessionId = sessionStore.activeSessionId;
  if (!sessionId) return null;
  const live = chatStore.getLiveState(sessionId);
  if (
    live.status === 'submitting' ||
    live.status === 'accepted' ||
    live.status === 'streaming' ||
    live.status === 'tool_running' ||
    live.status === 'stalled' ||
    live.pendingPermission ||
    live.pendingClarify
  ) {
    return sessionId;
  }
  return null;
}

async function saveLastSession(profileId: string): Promise<void> {
  const sessionId = sessionStore.activeSessionId;
  if (!sessionId) return;
  await api.profiles().setState(profileId, LAST_SESSION_KEY, sessionId).catch(() => undefined);
}

async function restoreLastSession(profileId: string): Promise<void> {
  await sessionStore.loadSessions();
  const result = await api.profiles().getState<string>(profileId, LAST_SESSION_KEY).catch(() => ({ value: null }));
  const target = result.value && sessionStore.sessions.some((session) => session.id === result.value)
    ? result.value
    : sessionStore.sessions[0]?.id ?? null;
  sessionStore.setActiveSession(target);
  if (target) {
    await chatStore.loadMessages(target);
  }
}

export const profileStore = {
  allProfilesKey: ALL_PROFILES,

  get profiles() { return profiles(); },
  get activeProfileId() { return activeProfileId(); },
  get activeProfile() { return activeProfile(); },
  get profileScope() { return profileScope(); },
  get showAllProfiles() { return showAllProfiles(); },
  get isLoading() { return isLoading(); },
  get error() { return error(); },

  setShowAllProfiles(value: boolean): void {
    setShowAllProfiles(value);
  },

  async refreshProfiles(): Promise<void> {
    setIsLoading(true);
    setError(null);
    try {
      const result = await api.profiles().list();
      setProfiles(result.profiles);
      setActiveProfileId(result.activeProfileId || 'default');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load profiles');
    } finally {
      setIsLoading(false);
    }
  },

  async createProfile(input: ProfileCreateRequest): Promise<ProfileInfo | null> {
    setError(null);
    try {
      const result = await api.profiles().create(input);
      await this.refreshProfiles();
      return result.profile;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create profile');
      return null;
    }
  },

  async updateProfile(profileId: string, input: ProfileUpdateRequest): Promise<ProfileInfo | null> {
    setError(null);
    try {
      const result = await api.profiles().update(profileId, input);
      await this.refreshProfiles();
      return result.profile;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save profile');
      return null;
    }
  },

  async removeProfile(profileId: string): Promise<boolean> {
    setError(null);
    try {
      const removingActive = activeProfileId() === profileId;
      if (removingActive) {
        const blockedSessionId = isSwitchBlocked();
        if (blockedSessionId) {
          setError('Stop the current turn before removing the active profile');
          return false;
        }
        await saveLastSession(profileId);
        const previousSessionId = sessionStore.activeSessionId;
        if (previousSessionId) {
          chatStore.clearMessages(previousSessionId);
        }
        sessionStore.setActiveSession(null);
        setShowAllProfiles(false);
      }
      await api.profiles().remove(profileId);
      if (activeProfileId() === profileId) {
        setActiveProfileId('default');
      }
      await this.refreshProfiles();
      if (removingActive) {
        await configStore.loadConfig();
        await restoreLastSession(activeProfileId());
      }
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to remove profile');
      return false;
    }
  },

  async switchProfile(profileId: string, options: { force?: boolean } = {}): Promise<boolean> {
    const target = profileId.trim() || 'default';
    if (target === activeProfileId() && !showAllProfiles()) return true;

    const blockedSessionId = isSwitchBlocked();
    if (blockedSessionId && !options.force) {
      throw new ProfileSwitchBlockedError(blockedSessionId);
    }

    setIsLoading(true);
    setError(null);
    try {
      const previousProfileId = activeProfileId();
      await saveLastSession(previousProfileId);
      if (blockedSessionId) {
        await sessionStore.interrupt().catch(() => false);
      }
      const previousSessionId = sessionStore.activeSessionId;
      if (previousSessionId) {
        chatStore.clearMessages(previousSessionId);
      }
      sessionStore.setActiveSession(null);
      setShowAllProfiles(false);

      const result = await api.profiles().setActive(target);
      setActiveProfileId(result.activeProfileId || result.profile.id);
      await this.refreshProfiles();
      await configStore.loadConfig();
      await restoreLastSession(result.activeProfileId || result.profile.id);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to switch profile');
      return false;
    } finally {
      setIsLoading(false);
    }
  },

  clearError(): void {
    setError(null);
  },
};
