import type { Component } from 'solid-js';
import { Show } from 'solid-js';
import type { SessionListItem } from '@/types/session.js';
import { Pill } from '@/ui/atoms/Pill.js';
import styles from './SessionCard.module.css';

interface SessionCardProps {
  session: SessionListItem;
  isActive: boolean;
  onSelect: (id: string) => void;
}

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
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
