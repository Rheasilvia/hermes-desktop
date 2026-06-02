import { onMount, type Component } from 'solid-js';
import { useNavigate } from '@solidjs/router';
import { sessionStore } from '@/stores/session.js';
import { Pill } from '@/ui/atoms/Pill.js';
import { Icon } from '@/ui/atoms/Icon.js';
import { formatRelativeTime } from '@/utils/time.js';
import { ChatCard } from './ChatCard.js';
import { CardList, CardRow } from './CardList.js';
import type { CardComponentProps } from './types.js';
import styles from './cards.module.css';

/**
 * `/history` and `/sessions` — recent sessions, read live from `sessionStore`.
 * Resume is a terminal action (dismiss + navigate); delete is non-terminal
 * (the store refreshes, the row disappears, the card stays open).
 */
export const SessionsCard: Component<CardComponentProps> = (props) => {
  const navigate = useNavigate();

  onMount(() => {
    if (sessionStore.sessions.length === 0) void sessionStore.loadSessions();
  });

  const resume = async (id: string) => {
    await sessionStore.resumeSession(id);
    props.onDismiss();
    navigate(`/conversation/${id}`);
  };

  return (
    <ChatCard title="Recent sessions" icon="clock" onClose={props.onDismiss}>
      <CardList
        state={{ items: sessionStore.sessions }}
        empty="No previous sessions yet."
      >
        {(s) => (
          <CardRow
            onActivate={() => void resume(s.id)}
            activateLabel="Resume this session"
            trailing={
              <button
                type="button"
                class={styles.rowTrailing}
                aria-label="Delete session"
                title="Delete session"
                onClick={(e) => { e.stopPropagation(); void sessionStore.deleteSession(s.id); }}
              >
                <Icon name="trash-2" size={14} />
              </button>
            }
          >
            <div class={styles.topRow}>
              <span class={styles.itemTitle}>{s.title || 'Untitled'}</span>
              <span class={styles.itemMeta}>{formatRelativeTime(s.started_at)}</span>
            </div>
            <div class={styles.itemMeta}>
              <Pill variant="secondary">{s.model}</Pill>
              <span>{s.message_count} msg{s.message_count !== 1 ? 's' : ''}</span>
            </div>
          </CardRow>
        )}
      </CardList>
    </ChatCard>
  );
};
