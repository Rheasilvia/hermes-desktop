import type { Component } from 'solid-js';
import { Card } from '@/ui/molecules/Card.js';
import { Badge } from '@/ui/atoms/Badge.js';
import styles from './StatusDashboard.module.css';

export interface DashboardData {
  connected: boolean;
  uptime: string;
  messagesToday: number;
  activeSessions: number;
}

interface StatusDashboardProps {
  data: DashboardData;
}

export const StatusDashboard: Component<StatusDashboardProps> = (props) => {
  return (
    <div class={styles.dashboard}>
      <Card padding="md" shadow="sm">
        <div class={styles.cardLabel}>Connection</div>
        <div class={styles.statusRow}>
          <Badge
            status={props.data.connected ? 'active' : 'inactive'}
            label={props.data.connected ? 'Connected' : 'Disconnected'}
          />
        </div>
      </Card>

      <Card padding="md" shadow="sm">
        <div class={styles.cardLabel}>Uptime</div>
        <div class={styles.cardValue}>{props.data.uptime}</div>
      </Card>

      <Card padding="md" shadow="sm">
        <div class={styles.cardLabel}>Messages Today</div>
        <div class={styles.cardValue}>{props.data.messagesToday}</div>
      </Card>

      <Card padding="md" shadow="sm">
        <div class={styles.cardLabel}>Active Sessions</div>
        <div class={styles.cardValue}>{props.data.activeSessions}</div>
      </Card>
    </div>
  );
};
