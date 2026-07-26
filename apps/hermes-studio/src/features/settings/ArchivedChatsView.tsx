import type { Component } from 'solid-js';
import { For, Show, onMount } from 'solid-js';
import { useNavigate } from '@solidjs/router';
import { sessionStore } from '@/stores/session.js';
import { Button } from '@/ui/atoms/Button.js';
import { EmptyState } from '@/ui/molecules/EmptyState.js';
import { LoadingSpinner } from '@/ui/atoms/LoadingSpinner.js';
import { Icon } from '@/ui/atoms/Icon.js';
import { formatRelativeTime } from '@/utils/time.js';
import styles from './ArchivedChatsView.module.css';

function formatArchiveTime(value: number | null | undefined, fallback: string): string {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return formatRelativeTime(new Date(value * 1000).toISOString());
  }
  return formatRelativeTime(fallback);
}

export const ArchivedChatsView: Component = () => {
  const navigate = useNavigate();

  onMount(() => {
    void sessionStore.loadArchivedSessions();
  });

  const handleRestore = async (id: string) => {
    const restored = await sessionStore.restoreSession(id);
    if (restored) {
      navigate(`/conversation/${id}`);
    }
  };

  const handleDelete = async (id: string) => {
    await sessionStore.deleteSession(id);
    await sessionStore.loadArchivedSessions();
  };

  return (
    <div class={styles.container}>
      <Show when={sessionStore.isLoading}>
        <div class={styles.loading}>
          <LoadingSpinner size="sm" label="Loading archived chats..." />
        </div>
      </Show>

      <Show when={sessionStore.error}>
        <div class={styles.errorBanner}>{sessionStore.error}</div>
      </Show>

      <Show
        when={sessionStore.archivedSessions.length > 0}
        fallback={
          <EmptyState
            iconName="archive"
            title="No archived chats"
            description="Archived conversations will appear here."
          />
        }
      >
        <div class={styles.list}>
          <For each={sessionStore.archivedSessions}>
            {(session) => (
              <div class={styles.row}>
                <div class={styles.rowIcon}>
                  <Icon name="archive" size={16} />
                </div>
                <div class={styles.rowMain}>
                  <div class={styles.titleRow}>
                    <span class={styles.title}>{session.title || 'Untitled'}</span>
                    <span class={styles.time}>
                      {formatArchiveTime(session.archivedAt, session.started_at)}
                    </span>
                  </div>
                  <div class={styles.metaRow}>
                    <span>{session.model || 'No model'}</span>
                    <span>{session.message_count} messages</span>
                    <Show when={session.cwd}>
                      {(cwd) => <span title={cwd()}>{cwd()}</span>}
                    </Show>
                  </div>
                </div>
                <div class={styles.actions}>
                  <Button variant="ghost" size="sm" onClick={() => void handleRestore(session.id)}>
                    <Icon name="archive-restore" size={14} />
                    Restore
                  </Button>
                  <Button variant="danger" size="sm" onClick={() => void handleDelete(session.id)}>
                    <Icon name="trash-2" size={14} />
                    Delete
                  </Button>
                </div>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
};
