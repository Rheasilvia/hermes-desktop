import { type Component } from 'solid-js';
import { ChatCard } from './ChatCard.js';
import { CardOutput } from './CardOutput.js';
import type { CardComponentProps } from './types.js';
import styles from './cards.module.css';

/** CLI-text cards — the backend already captured the text into `props.text`. */

export const OutputCard: Component<CardComponentProps> = (props) => (
  <ChatCard title="Output" icon="terminal" onClose={props.onDismiss}>
    <CardOutput text={props.text} />
  </ChatCard>
);

export const LogsCard: Component<CardComponentProps> = (props) => (
  <ChatCard title="Logs" icon="file-text" onClose={props.onDismiss}>
    <CardOutput text={props.text} empty="No recent log lines." />
  </ChatCard>
);

export const AccountCard: Component<CardComponentProps> = (props) => (
  <ChatCard title="Account" icon="user" onClose={props.onDismiss}>
    <CardOutput text={props.text} />
  </ChatCard>
);

/** Deferred / terminal-only / error commands → a short notice (plain text). */
export const NoticeCard: Component<CardComponentProps> = (props) => (
  <ChatCard title="Not available" icon="alert-circle" onClose={props.onDismiss}>
    <p class={styles.state} role="status">{props.text || 'This command is not available in Desktop.'}</p>
  </ChatCard>
);
