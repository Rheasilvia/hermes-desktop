import type { Component } from 'solid-js';
import { For, Show } from 'solid-js';
import type { McpServer, McpTool, McpConnectionStatus } from '@/types/mcp.js';
import { ProtocolBadge } from './ProtocolBadge.js';
import styles from './ServerDetail.module.css';

export interface HistoryEntry {
  ok: boolean;
  event: string;
  timestamp: string;
}

export interface ServerDetailProps {
  server: McpServer;
  status: McpConnectionStatus | undefined;
  tools: McpTool[];
  history: HistoryEntry[];
  onClose: () => void;
}

export const ServerDetail: Component<ServerDetailProps> = (props) => {
  const connected = () => props.status?.connected ?? false;

  const configJson = (): string => {
    const cfg: Record<string, unknown> = {};
    if (props.server.url) cfg.url = props.server.url;
    if (props.server.command) cfg.command = props.server.command;
    if (props.server.args) cfg.args = props.server.args;
    if (props.server.headers) {
      cfg.headers = Object.fromEntries(
        Object.entries(props.server.headers).map(([k, v]) => [
          k,
          k.toLowerCase().includes('auth') || k.toLowerCase().includes('key')
            ? '***'
            : v,
        ])
      );
    }
    if (props.server.env) {
      cfg.env = Object.fromEntries(
        Object.entries(props.server.env).map(([k, v]) => [
          k,
          k.toLowerCase().includes('key') || k.toLowerCase().includes('secret')
            ? '***'
            : v,
        ])
      );
    }
    if (props.server.timeout) cfg.timeout = props.server.timeout;
    return JSON.stringify(cfg, null, 2);
  };

  return (
    <div class={styles.detail}>
      <div class={styles.header}>
        <div class={styles.headerTop}>
          <h2 class={styles.serverName}>{props.server.name}</h2>
          <ProtocolBadge transport={props.server.transport ?? 'stdio'} />
          <span class={`${styles.statusPill} ${connected() ? styles.pillOnline : styles.pillOffline}`}>
            <span class={styles.pillDot} />
            {connected() ? 'Online' : 'Offline'}
          </span>
        </div>
        <div class={styles.headerMeta}>
          {(props.status?.tools ?? 0)} tool{(props.status?.tools ?? 0) !== 1 ? 's' : ''}
        </div>
        <button class={styles.closeBtn} type="button" onClick={props.onClose}>
          &times;
        </button>
      </div>

      <section class={styles.section}>
        <h3 class={styles.sectionTitle}>Discovered Tools</h3>
        <Show
          when={props.tools.length > 0}
          fallback={<p class={styles.emptyText}>No tools discovered yet</p>}
        >
          <For each={props.tools}>
            {(tool) => (
              <div class={styles.toolItem}>
                <span class={styles.toolName}>{tool.name}</span>
                <Show when={tool.description}>
                  <span class={styles.toolDesc}> — {tool.description}</span>
                </Show>
              </div>
            )}
          </For>
        </Show>
      </section>

      <section class={styles.section}>
        <h3 class={styles.sectionTitle}>Configuration</h3>
        <pre class={styles.codeBlock}>{configJson()}</pre>
      </section>

      <section class={styles.section}>
        <h3 class={styles.sectionTitle}>Connection History</h3>
        <Show
          when={props.history.length > 0}
          fallback={<p class={styles.emptyText}>No history available</p>}
        >
          <div class={styles.historyList}>
            <For each={props.history}>
              {(entry) => (
                <div class={styles.historyItem}>
                  <span
                    class={`${styles.historyDot} ${entry.ok ? styles.dotOk : styles.dotErr}`}
                  />
                  <span class={styles.historyEvent}>{entry.event}</span>
                  <span class={styles.historyTime}>{entry.timestamp}</span>
                </div>
              )}
            </For>
          </div>
        </Show>
      </section>
    </div>
  );
};
