import type { Component } from 'solid-js';
import { Show } from 'solid-js';
import type { SessionListItem } from '@/types/session.js';
import { Pill } from '@/ui/atoms/Pill.js';
import { formatRelativeTime } from '@/utils/time.js';
import styles from './SessionCard.module.css';

interface SessionCardProps {
  session: SessionListItem;
  isActive: boolean;
  onSelect: (id: string) => void;
}

function truncateTitle(title: string, maxLen: number = 40): string {
  if (title.length <= maxLen) return title;
  return title.slice(0, maxLen - 1) + '…';
}

export const SessionCard: Component<SessionCardProps> = (props) => {
  const handleClick = () => {
    props.onSelect(props.session.id);
  };

  return (
    <button
      class={`${styles.card} ${props.isActive ? styles.active : ''}`}
      type="button"
      onClick={handleClick}
      aria-current={props.isActive ? 'true' : undefined}
    >
      <Show when={props.isActive}>
        <div class={styles.activeBar} />
      </Show>
      <div class={styles.content}>
        <div class={styles.topRow}>
          <span class={styles.title} title={props.session.title}>
            {truncateTitle(props.session.title)}
          </span>
          <span class={styles.timestamp}>
            {formatRelativeTime(props.session.started_at)}
          </span>
        </div>
        <div class={styles.bottomRow}>
          <Pill variant="secondary">{props.session.model}</Pill>
          <span class={styles.messageCount}>
            {props.session.message_count} msg{props.session.message_count !== 1 ? 's' : ''}
          </span>
        </div>
        <Show when={props.session.last_message}>
          <p class={styles.preview}>{props.session.last_message}</p>
        </Show>
      </div>
    </button>
  );
};
