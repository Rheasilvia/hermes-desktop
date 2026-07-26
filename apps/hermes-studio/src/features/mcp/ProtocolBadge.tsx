import type { Component } from 'solid-js';
import type { McpTransport } from '@/types/mcp.js';
import styles from './ProtocolBadge.module.css';

export interface ProtocolBadgeProps {
  transport: McpTransport;
}

const LABELS: Record<McpTransport, string> = {
  stdio: 'stdio',
  http: 'HTTP',
  streamable_http: 'Streamable HTTP',
  sse: 'SSE',
};

export const ProtocolBadge: Component<ProtocolBadgeProps> = (props) => (
  <span class={`${styles.badge} ${styles[props.transport]}`}>
    {LABELS[props.transport]}
  </span>
);
