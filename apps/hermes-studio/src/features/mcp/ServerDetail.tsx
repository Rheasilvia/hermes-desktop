import type { Component } from 'solid-js';
import { For, Show } from 'solid-js';
import type { McpServer, McpTool, McpConnectionStatus } from '@/types/mcp.js';
import { ProtocolBadge } from './ProtocolBadge.js';
import { mcpStatusLabel, mcpStatusTone } from './status.js';
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
  toolsLoading: boolean;
  toolsError: string | null;
  history: HistoryEntry[];
  onClose: () => void;
}

export const ServerDetail: Component<ServerDetailProps> = (props) => {
  const tone = () => mcpStatusTone(props.server, props.status);
  const pillClass = () => styles[`pill${tone()[0].toUpperCase()}${tone().slice(1)}`];
  const statusMessage = () => props.server.error ?? props.status?.error ?? null;

  const configJson = (): string => {
    const cfg: Record<string, unknown> = {};
    if (props.server.transport) cfg.transport = props.server.transport;
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
          <span class={`${styles.statusPill} ${pillClass()}`}>
            <span class={styles.pillDot} />
            {mcpStatusLabel(tone())}
          </span>
        </div>
        <div class={styles.headerMeta}>
          {(props.status?.tools ?? 0)} tool{(props.status?.tools ?? 0) !== 1 ? 's' : ''}
        </div>
        <Show when={statusMessage()}>
          {(message) => <div class={styles.statusError}>{message()}</div>}
        </Show>
        <button class={styles.closeBtn} type="button" onClick={props.onClose}>
          &times;
        </button>
      </div>

      <section class={styles.section}>
        <h3 class={styles.sectionTitle}>Discovered Tools</h3>
        <Show
          when={!props.toolsLoading}
          fallback={<p class={styles.emptyText}>Loading tools...</p>}
        >
          <Show
            when={!props.toolsError}
            fallback={<p class={styles.errorText}>{props.toolsError}</p>}
          >
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
          </Show>
        </Show>
      </section>

      <Show when={props.server.desktop?.note}>
        {(note) => (
          <section class={styles.section}>
            <h3 class={styles.sectionTitle}>Desktop Note</h3>
            <p class={styles.emptyText}>{note()}</p>
          </section>
        )}
      </Show>

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
