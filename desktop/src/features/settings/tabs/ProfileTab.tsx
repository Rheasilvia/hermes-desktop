import type { Component } from 'solid-js';
import { For, Show, createEffect, createMemo, createSignal, onMount } from 'solid-js';
import { Button } from '@/ui/atoms/Button.js';
import { Icon } from '@/ui/atoms/Icon.js';
import { Modal } from '@/ui/molecules/Modal.js';
import { profileStore, ProfileSwitchBlockedError } from '@/stores/profile.js';
import { api, type ProfileInfo } from '@/services/api';
import type { SessionListItem } from '@/types/session';
import styles from './ProfileTab.module.css';

function formatDate(value: number | null): string {
  if (!value) return 'Never';
  return new Date(value * 1000).toLocaleString();
}

function modelSummary(profile: ProfileInfo): string {
  if (profile.model && profile.provider) return `${profile.provider} / ${profile.model}`;
  if (profile.model) return profile.model;
  if (profile.provider) return profile.provider;
  return 'Not configured';
}

function sessionTimestamp(session: SessionListItem): string {
  const value = session.last_active ?? session.started_at;
  if (!value) return 'No activity';
  if (typeof value === 'number') return new Date(value * 1000).toLocaleString();
  return new Date(value).toLocaleString();
}

export const ProfileTab: Component = () => {
  const [selectedId, setSelectedId] = createSignal('default');
  const [editName, setEditName] = createSignal('');
  const [editSoul, setEditSoul] = createSignal('');
  const [createOpen, setCreateOpen] = createSignal(false);
  const [createName, setCreateName] = createSignal('');
  const [createCloneFrom, setCreateCloneFrom] = createSignal('default');
  const [createSoul, setCreateSoul] = createSignal('');
  const [removeTarget, setRemoveTarget] = createSignal<ProfileInfo | null>(null);
  const [pendingSwitchId, setPendingSwitchId] = createSignal<string | null>(null);
  const [allProfileSessions, setAllProfileSessions] = createSignal<SessionListItem[]>([]);
  const [allProfilesLoading, setAllProfilesLoading] = createSignal(false);
  const [allProfilesError, setAllProfilesError] = createSignal<string | null>(null);
  const [saving, setSaving] = createSignal(false);

  onMount(() => {
    void profileStore.refreshProfiles().then(() => {
      setSelectedId(profileStore.activeProfileId);
    });
  });

  const selectedProfile = createMemo(() =>
    profileStore.profiles.find((profile) => profile.id === selectedId())
      ?? profileStore.activeProfile
      ?? profileStore.profiles[0]
      ?? null,
  );

  const groupedSessions = createMemo(() => {
    const groups = new Map<string, { profileName: string; rows: SessionListItem[] }>();
    for (const session of allProfileSessions()) {
      const profileId = session.profileId ?? 'default';
      const profileName = session.profileName ?? profileId;
      const group = groups.get(profileId) ?? { profileName, rows: [] };
      group.rows.push(session);
      groups.set(profileId, group);
    }
    return Array.from(groups.entries()).map(([profileId, group]) => ({
      profileId,
      ...group,
    }));
  });

  const loadAllProfileSessions = async () => {
    setAllProfilesLoading(true);
    setAllProfilesError(null);
    try {
      const result = await api.profiles().sessions('all');
      setAllProfileSessions(result.sessions);
    } catch (e) {
      setAllProfilesError(e instanceof Error ? e.message : 'Failed to load all profile sessions');
    } finally {
      setAllProfilesLoading(false);
    }
  };

  createEffect(() => {
    const profile = selectedProfile();
    if (!profile) return;
    setEditName(profile.name);
    setEditSoul(profile.soul ?? '');
  });

  createEffect(() => {
    const active = profileStore.activeProfileId;
    if (!selectedId() && active) setSelectedId(active);
  });

  createEffect(() => {
    if (profileStore.showAllProfiles) {
      void loadAllProfileSessions();
    } else {
      setAllProfileSessions([]);
      setAllProfilesError(null);
    }
  });

  const handleSwitch = async (profileId: string, force = false) => {
    try {
      const ok = await profileStore.switchProfile(profileId, { force });
      if (ok) setSelectedId(profileId);
    } catch (e) {
      if (e instanceof ProfileSwitchBlockedError) {
        setPendingSwitchId(profileId);
        return;
      }
      throw e;
    }
  };

  const handleCreate = async () => {
    const name = createName().trim();
    if (!name) return;
    const profile = await profileStore.createProfile({
      name,
      cloneFrom: createCloneFrom() || null,
      soul: createSoul() || null,
    });
    if (profile) {
      setCreateOpen(false);
      setCreateName('');
      setCreateSoul('');
      setSelectedId(profile.id);
    }
  };

  const handleSave = async () => {
    const profile = selectedProfile();
    if (!profile) return;
    setSaving(true);
    const updated = await profileStore.updateProfile(profile.id, {
      name: editName(),
      soul: editSoul(),
    });
    setSaving(false);
    if (updated) setSelectedId(updated.id);
  };

  const handleRemove = async () => {
    const target = removeTarget();
    if (!target) return;
    const ok = await profileStore.removeProfile(target.id);
    if (ok) {
      setRemoveTarget(null);
      setSelectedId(profileStore.activeProfileId);
    }
  };

  const copySetupCommand = async (profile: ProfileInfo) => {
    await navigator.clipboard.writeText(profile.setupCommand).catch(() => undefined);
  };

  return (
    <div class={styles.tab}>
      <Show when={profileStore.error}>
        <div class={styles.errorBanner} role="alert">
          {profileStore.error}
        </div>
      </Show>

      <section class={styles.section}>
        <div class={styles.sectionHeader}>
          <div>
            <h3 class={styles.sectionTitle}>Active Profile</h3>
          </div>
          <Button variant="secondary" size="sm" onClick={() => void profileStore.refreshProfiles()}>
            <Icon name="refresh-cw" size={14} />
            <span>Refresh</span>
          </Button>
        </div>

        <Show
          when={!profileStore.isLoading}
          fallback={<div class={styles.loading}>Loading profiles...</div>}
        >
          <Show when={profileStore.activeProfile} fallback={<div class={styles.empty}>No active profile found.</div>}>
            {(profile) => (
              <div class={styles.activeCard}>
                <div class={styles.avatar} aria-hidden="true">{profile().name.slice(0, 1).toUpperCase()}</div>
                <div class={styles.activeDetails}>
                  <div class={styles.activeTitleRow}>
                    <h4 class={styles.activeTitle}>{profile().name}</h4>
                    <Show when={profile().isDefault}>
                      <span class={styles.badge}>Default</span>
                    </Show>
                  </div>
                  <div class={styles.metaGrid}>
                    <span>Path</span>
                    <code>{profile().path}</code>
                    <span>Model</span>
                    <strong>{modelSummary(profile())}</strong>
                    <span>Secrets</span>
                    <strong>{profile().hasEnv ? '.env present' : 'No .env'}</strong>
                    <span>Sessions</span>
                    <strong>{profile().sessionCount}</strong>
                  </div>
                </div>
              </div>
            )}
          </Show>
        </Show>
      </section>

      <section class={styles.section}>
        <div class={styles.sectionHeader}>
          <div>
            <h3 class={styles.sectionTitle}>Profiles</h3>
          </div>
          <Button variant="primary" size="sm" onClick={() => setCreateOpen(true)}>
            <Icon name="plus" size={14} />
            <span>New profile</span>
          </Button>
        </div>

        <Show when={profileStore.profiles.length > 1}>
          <label class={styles.allProfilesToggle}>
            <input
              type="checkbox"
              checked={profileStore.showAllProfiles}
              onChange={(event) => profileStore.setShowAllProfiles(event.currentTarget.checked)}
            />
            <span>All Profiles</span>
          </label>
        </Show>

        <div class={styles.profileList} role="list" aria-label="Profiles">
          <For each={profileStore.profiles}>
            {(profile) => (
              <div
                role="button"
                tabIndex={0}
                class={styles.profileRow}
                classList={{
                  [styles.profileRowActive]: profile.id === profileStore.activeProfileId,
                  [styles.profileRowSelected]: profile.id === selectedProfile()?.id,
                }}
                onClick={() => setSelectedId(profile.id)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    setSelectedId(profile.id);
                  }
                }}
              >
                <span class={styles.profileGlyph} aria-hidden="true">{profile.name.slice(0, 1).toUpperCase()}</span>
                <span class={styles.profileMain}>
                  <span class={styles.profileName}>
                    {profile.name}
                    <Show when={profile.isDefault}>
                      <span class={styles.inlineBadge}>Default</span>
                    </Show>
                  </span>
                  <span class={styles.profilePath}>{profile.path}</span>
                </span>
                <span class={styles.profileStats}>
                  <span>{profile.sessionCount} sessions</span>
                  <span>{modelSummary(profile)}</span>
                </span>
                <span class={styles.profileActions}>
                  <Button
                    variant={profile.id === profileStore.activeProfileId ? 'secondary' : 'primary'}
                    size="sm"
                    disabled={profile.id === profileStore.activeProfileId}
                    onClick={(event) => {
                      event.stopPropagation();
                      void handleSwitch(profile.id);
                    }}
                  >
                    {profile.id === profileStore.activeProfileId ? 'Active' : 'Switch'}
                  </Button>
                </span>
              </div>
            )}
          </For>
        </div>
      </section>

      <Show when={selectedProfile()}>
        {(profile) => (
          <section class={styles.section}>
            <div class={styles.sectionHeader}>
              <div>
                <h3 class={styles.sectionTitle}>Profile Details</h3>
              </div>
              <div class={styles.headerActions}>
                <Button variant="secondary" size="sm" onClick={() => void copySetupCommand(profile())}>
                  <Icon name="copy" size={14} />
                  <span>Copy setup</span>
                </Button>
                <Show when={!profile().isDefault}>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => void profileStore.updateProfile(profile().id, { isDefault: true })}
                  >
                    <Icon name="check-circle" size={14} />
                    <span>Make default</span>
                  </Button>
                </Show>
                <Button variant="primary" size="sm" disabled={saving()} onClick={() => void handleSave()}>
                  <Icon name="save" size={14} />
                  <span>{saving() ? 'Saving' : 'Save'}</span>
                </Button>
              </div>
            </div>

            <div class={styles.detailGrid}>
              <label class={styles.field}>
                <span>Display name</span>
                <input
                  value={editName()}
                  onInput={(event) => setEditName(event.currentTarget.value)}
                />
              </label>

              <label class={styles.field}>
                <span>Hermes home</span>
                <input value={profile().path} readOnly />
              </label>

              <label class={styles.field}>
                <span>Setup command</span>
                <input value={profile().setupCommand} readOnly />
              </label>

              <label class={styles.field}>
                <span>Last used</span>
                <input value={formatDate(profile().lastUsedAt)} readOnly />
              </label>
            </div>

            <label class={styles.field}>
              <span>SOUL.md</span>
              <textarea
                rows={10}
                value={editSoul()}
                onInput={(event) => setEditSoul(event.currentTarget.value)}
              />
            </label>

            <div class={styles.dangerZone}>
              <div>
                <h4>Remove from desktop</h4>
                <p>This hides the profile from Tauri desktop. The profile directory is not deleted.</p>
              </div>
              <Button
                variant="danger"
                size="sm"
                disabled={profile().isDefault}
                onClick={() => setRemoveTarget(profile())}
              >
                <Icon name="trash-2" size={14} />
                <span>Remove</span>
              </Button>
            </div>
          </section>
        )}
      </Show>

      <Show when={profileStore.showAllProfiles}>
        <section class={styles.section} aria-label="All Profiles Sessions">
          <div class={styles.sectionHeader}>
            <div>
              <h3 class={styles.sectionTitle}>All Profiles Sessions</h3>
            </div>
            <Button variant="secondary" size="sm" onClick={() => void loadAllProfileSessions()}>
              <Icon name="refresh-cw" size={14} />
              <span>Refresh</span>
            </Button>
          </div>
          <Show when={allProfilesError()}>
            <div class={styles.errorBanner} role="alert">{allProfilesError()}</div>
          </Show>
          <Show
            when={!allProfilesLoading()}
            fallback={<div class={styles.loading}>Loading sessions...</div>}
          >
            <Show when={groupedSessions().length > 0} fallback={<div class={styles.empty}>No sessions found.</div>}>
              <div class={styles.sessionGroups}>
                <For each={groupedSessions()}>
                  {(group) => (
                    <section class={styles.sessionGroup} aria-label={`${group.profileName} sessions`}>
                      <h4 class={styles.sessionGroupTitle}>
                        {group.profileName}
                        <span>{group.rows.length}</span>
                      </h4>
                      <div class={styles.sessionRows}>
                        <For each={group.rows}>
                          {(session) => (
                            <div class={styles.sessionRow}>
                              <span class={styles.sessionTitle}>{session.title || 'Untitled'}</span>
                              <span class={styles.sessionMeta}>
                                {session.message_count} messages | {session.model || 'No model'} | {sessionTimestamp(session)}
                              </span>
                            </div>
                          )}
                        </For>
                      </div>
                    </section>
                  )}
                </For>
              </div>
            </Show>
          </Show>
        </section>
      </Show>

      <Modal
        open={createOpen()}
        title="Create profile"
        onClose={() => setCreateOpen(false)}
        footer={(
          <>
            <Button variant="secondary" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button variant="primary" disabled={!createName().trim()} onClick={() => void handleCreate()}>Create</Button>
          </>
        )}
      >
        <div class={styles.modalForm}>
          <label class={styles.field}>
            <span>Profile id</span>
            <input
              placeholder="research"
              value={createName()}
              onInput={(event) => setCreateName(event.currentTarget.value)}
            />
          </label>
          <label class={styles.field}>
            <span>Clone from</span>
            <select
              value={createCloneFrom()}
              onChange={(event) => setCreateCloneFrom(event.currentTarget.value)}
            >
              <option value="">None</option>
              <For each={profileStore.profiles}>
                {(profile) => <option value={profile.id}>{profile.name}</option>}
              </For>
            </select>
          </label>
          <label class={styles.field}>
            <span>Initial SOUL.md</span>
            <textarea
              rows={6}
              value={createSoul()}
              onInput={(event) => setCreateSoul(event.currentTarget.value)}
            />
          </label>
        </div>
      </Modal>

      <Modal
        open={removeTarget() !== null}
        title="Remove profile"
        onClose={() => setRemoveTarget(null)}
        footer={(
          <>
            <Button variant="secondary" onClick={() => setRemoveTarget(null)}>Cancel</Button>
            <Button variant="danger" onClick={() => void handleRemove()}>Remove</Button>
          </>
        )}
      >
        <p class={styles.modalText}>
          Remove {removeTarget()?.name} from Tauri desktop? The profile directory and data remain on disk.
        </p>
      </Modal>

      <Modal
        open={pendingSwitchId() !== null}
        title="Switch profile?"
        onClose={() => setPendingSwitchId(null)}
        footer={(
          <>
            <Button variant="secondary" onClick={() => setPendingSwitchId(null)}>Stay</Button>
            <Button
              variant="danger"
              onClick={() => {
                const id = pendingSwitchId();
                setPendingSwitchId(null);
                if (id) void handleSwitch(id, true);
              }}
            >
              Stop and switch
            </Button>
          </>
        )}
      >
        <p class={styles.modalText}>
          The current session is running or waiting for input. Stop it before switching profiles.
        </p>
      </Modal>
    </div>
  );
};
