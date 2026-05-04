import type { Component } from 'solid-js';
import { For } from 'solid-js';
import styles from './MessageLog.module.css';

export interface LogEntry {
  time: string;
  sender: string;
  platform: string;
  content: string;
  status: 'delivered' | 'read' | 'error';
}

interface MessageLogProps {
  messages: LogEntry[];
}

const STATUS_CLASS: Record<string, string> = {
  delivered: styles.statusDelivered,
  read: styles.statusRead,
  error: styles.statusError,
};

export const MessageLog: Component<MessageLogProps> = (props) => {
  return (
    <div class={styles.wrapper}>
      <div class={styles.header}>
        <h3 class={styles.title}>Recent Messages</h3>
      </div>
      <div class={styles.tableWrap}>
        <table class={styles.table}>
          <thead>
            <tr>
              <th>Time</th>
              <th>Sender</th>
              <th>Platform</th>
              <th>Content</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            <For each={props.messages}>
              {(msg) => (
                <tr>
                  <td class={styles.timeCell}>{msg.time}</td>
                  <td class={styles.senderCell}>{msg.sender}</td>
                  <td class={styles.platformCell}>{msg.platform}</td>
                  <td class={styles.contentCell}>{msg.content}</td>
                  <td class={STATUS_CLASS[msg.status] ?? ''}>{msg.status}</td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </div>
    </div>
  );
};
