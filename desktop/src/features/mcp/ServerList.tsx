import type { Component } from 'solid-js';
import { For, Show } from 'solid-js';
import type { McpServer, McpConnectionStatus } from '@/types/mcp.js';
import { ProtocolBadge } from './ProtocolBadge.js';
import styles from './ServerList.module.css';

export interface ServerListProps {
  servers: McpServer[];
  statuses: Map<string, McpConnectionStatus>;
  selectedName: string | null;
  onSelect: (name: string) => void;
  onDelete: (name: string) => void;
}

export const ServerList: Component<ServerListProps> = (props) => {
  const toolCount = (name: string): number => {
    const status = props.statuses.get(name);
    return status?.tools ?? 0;
  };

  const isConnected = (name: string): boolean => {
    const status = props.statuses.get(name);
    return status?.connected ?? false;
  };

  return (
    <div class={styles.list}>
      <For each={props.servers}>
        {(server) => {
          const connected = () => isConnected(server.name);
          const count = () => toolCount(server.name);
          const selected = () => props.selectedName === server.name;

          return (
            <div
              class={`${styles.row} ${selected() ? styles.rowSelected : ''}`}
              onClick={() => props.onSelect(server.name)}
            >
              <div class={styles.rowLeft}>
                <span
                  class={`${styles.statusDot} ${connected() ? styles.dotOnline : styles.dotOffline}`}
                />
                <span class={styles.serverName}>{server.name}</span>
                <ProtocolBadge transport={server.transport ?? 'stdio'} />
              </div>
              <div class={styles.rowRight}>
                <span class={styles.toolCount}>
                  {count()} tool{count() !== 1 ? 's' : ''}
                </span>
                <div class={styles.actions}>
                  <button
                    class={styles.actionLink}
                    type="button"
                    onClick={(e) => { e.stopPropagation(); props.onSelect(server.name); }}
                  >
                    Edit
                  </button>
                  <button
                    class={styles.actionLink}
                    type="button"
                    onClick={(e) => { e.stopPropagation(); void 0; }}
                  >
                    Test
                  </button>
                  <button
                    class={`${styles.actionLink} ${styles.actionDanger}`}
                    type="button"
                    onClick={(e) => { e.stopPropagation(); props.onDelete(server.name); }}
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          );
        }}
      </For>
      <Show when={props.servers.length === 0}>
        <div class={styles.empty}>
          <p>No MCP servers configured</p>
          <p class={styles.emptyHint}>Click "+ Add Server" to get started</p>
        </div>
      </Show>
    </div>
  );
};
