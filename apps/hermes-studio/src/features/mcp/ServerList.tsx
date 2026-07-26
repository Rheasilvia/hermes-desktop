import type { Component } from 'solid-js';
import { For, Show } from 'solid-js';
import type { McpServer, McpConnectionStatus } from '@/types/mcp.js';
import { ProtocolBadge } from './ProtocolBadge.js';
import { mcpStatusCompactLabel, mcpStatusTone } from './status.js';
import styles from './ServerList.module.css';

export interface ServerListProps {
  servers: McpServer[];
  statuses: Map<string, McpConnectionStatus>;
  selectedName: string | null;
  onSelect: (name: string) => void;
  onDelete: (name: string) => void;
  onTogglePin: (name: string, pinned: boolean) => void;
}

export const ServerList: Component<ServerListProps> = (props) => {
  const toolCount = (name: string): number => {
    const status = props.statuses.get(name);
    return status?.tools ?? 0;
  };

  const dotClass = (server: McpServer): string => {
    const tone = mcpStatusTone(server, props.statuses.get(server.name));
    return styles[`dot${tone[0].toUpperCase()}${tone.slice(1)}`];
  };

  return (
    <div class={styles.list}>
      <For each={props.servers}>
        {(server) => {
          const count = () => toolCount(server.name);
          const selected = () => props.selectedName === server.name;
          const status = () => props.statuses.get(server.name);
          const tone = () => mcpStatusTone(server, status());

          return (
            <div
              class={`${styles.row} ${selected() ? styles.rowSelected : ''}`}
              onClick={() => props.onSelect(server.name)}
            >
              <div class={styles.rowLeft}>
                <span
                  class={`${styles.statusDot} ${dotClass(server)}`}
                />
                <Show when={server.desktop?.pinned}>
                  <span class={styles.pinMark}>Pinned</span>
                </Show>
                <span class={styles.serverName}>{server.name}</span>
                <ProtocolBadge transport={server.transport ?? 'stdio'} />
                <span class={styles.statusText}>{mcpStatusCompactLabel(tone())}</span>
                <Show when={server.valid === false}>
                  <span class={styles.invalidText}>{server.error ?? 'Invalid config'}</span>
                </Show>
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
                    onClick={(e) => {
                      e.stopPropagation();
                      props.onTogglePin(server.name, !(server.desktop?.pinned ?? false));
                    }}
                  >
                    {server.desktop?.pinned ? 'Unpin' : 'Pin'}
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
