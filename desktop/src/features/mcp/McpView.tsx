import type { Component } from 'solid-js';
import { createSignal, Show, onMount, createMemo } from 'solid-js';
import type { McpServer, McpTool, McpConnectionStatus } from '@/types/mcp.js';
import { getGateway } from '@/stores/context.js';
import { Button } from '@/ui/atoms/Button.js';
import { Modal } from '@/ui/molecules/Modal.js';
import { LoadingSpinner } from '@/ui/atoms/LoadingSpinner.js';
import { ServerList } from './ServerList.js';
import { AddServerForm } from './AddServerForm.js';
import type { AddServerFormData } from './AddServerForm.js';
import { ServerDetail } from './ServerDetail.js';
import type { HistoryEntry } from './ServerDetail.js';
import styles from './McpView.module.css';

export const McpView: Component = () => {
  const [servers, setServers] = createSignal<McpServer[]>([]);
  const [statuses, setStatuses] = createSignal<Map<string, McpConnectionStatus>>(new Map());
  const [selectedName, setSelectedName] = createSignal<string | null>(null);
  const [showAddForm, setShowAddForm] = createSignal(false);
  const [serverTools, setServerTools] = createSignal<Map<string, McpTool[]>>(new Map());
  const [loading, setLoading] = createSignal(true);

  onMount(async () => {
    const gateway = getGateway();
    if (gateway) {
      try {
        const list = await gateway.mcp.list();
        setServers(list);
        const statusesMap = new Map<string, McpConnectionStatus>();
        const toolsMap = new Map<string, McpTool[]>();
        for (const server of list) {
          try {
            const tools = await gateway.mcp.tools(server.name);
            statusesMap.set(server.name, {
              name: server.name,
              connected: tools.length > 0,
              transport: server.transport ?? 'stdio',
              tools: tools.length,
            });
            toolsMap.set(server.name, tools);
          } catch {
            statusesMap.set(server.name, {
              name: server.name,
              connected: false,
              transport: server.transport ?? 'stdio',
              tools: 0,
              error: 'Failed to connect',
            });
          }
        }
        setStatuses(statusesMap);
        setServerTools(toolsMap);
      } catch {
        // Keep empty state on error
      }
    }
    setLoading(false);
  });

  const selectedServer = createMemo((): McpServer | null => {
    const name = selectedName();
    if (!name) return null;
    return servers().find((s) => s.name === name) ?? null;
  });

  const selectedStatus = createMemo((): McpConnectionStatus | undefined => {
    const name = selectedName();
    if (!name) return undefined;
    return statuses().get(name);
  });

  const selectedTools = createMemo((): McpTool[] => {
    const name = selectedName();
    if (!name) return [];
    return serverTools().get(name) ?? [];
  });

  const selectedHistory = createMemo((): HistoryEntry[] => {
    return [];
  });

  const handleAddServer = async (data: AddServerFormData) => {
    const newServer: McpServer = {
      name: data.name,
      transport: data.transport,
      command: data.command,
      args: data.args,
      env: data.env,
      url: data.url,
      headers: data.headers,
      timeout: data.timeout,
    };

    const gateway = getGateway();
    if (gateway) {
      try {
        const added = await gateway.mcp.add(newServer);
        setServers((prev) => [...prev, added]);
      } catch {
        setServers((prev) => [...prev, newServer]);
      }
    } else {
      setServers((prev) => [...prev, newServer]);
    }

    setStatuses((prev) => {
      const next = new Map(prev);
      next.set(data.name, {
        name: data.name,
        connected: false,
        transport: data.transport,
        tools: 0,
        error: 'Not connected',
      });
      return next;
    });

    setShowAddForm(false);
  };

  const handleDeleteServer = async (name: string) => {
    const gateway = getGateway();
    if (gateway) {
      try {
        await gateway.mcp.remove(name);
      } catch {
        void 0;
      }
    }

    setServers((prev) => prev.filter((s) => s.name !== name));
    setStatuses((prev) => {
      const next = new Map(prev);
      next.delete(name);
      return next;
    });
    if (selectedName() === name) {
      setSelectedName(null);
    }
  };

  return (
    <div class={styles.mcpView}>
      <div class={styles.toolbar}>
        <h2 class={styles.title}>MCP Servers</h2>
        <Button variant="primary" size="sm" onClick={() => setShowAddForm(true)}>
          + Add Server
        </Button>
      </div>

      <div class={styles.content}>
        <Show
          when={!loading()}
          fallback={
            <div class={styles.loadingWrap}>
              <LoadingSpinner size="md" />
            </div>
          }
        >
          <div class={styles.listPanel}>
            <ServerList
              servers={servers()}
              statuses={statuses()}
              selectedName={selectedName()}
              onSelect={setSelectedName}
              onDelete={handleDeleteServer}
            />
          </div>
          <Show when={selectedServer()}>
            {(server) => (
              <div class={styles.detailPanel}>
                <ServerDetail
                  server={server()}
                  status={selectedStatus()}
                  tools={selectedTools()}
                  history={selectedHistory()}
                  onClose={() => setSelectedName(null)}
                />
              </div>
            )}
          </Show>
        </Show>
      </div>

      <Show when={showAddForm()}>
        <Modal
          open={showAddForm()}
          title="Add MCP Server"
          onClose={() => setShowAddForm(false)}
        >
          <AddServerForm
            onSubmit={handleAddServer}
            onCancel={() => setShowAddForm(false)}
          />
        </Modal>
      </Show>
    </div>
  );
};
