import type { Component } from 'solid-js';
import { createSignal, Show, onMount, createMemo } from 'solid-js';
import type { McpServer, McpTool, McpConnectionStatus } from '@/types/mcp.js';
import { api } from '@/services/api/router.js';
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
  const [toolsLoading, setToolsLoading] = createSignal<Set<string>>(new Set());
  const [toolsError, setToolsError] = createSignal<Map<string, string>>(new Map());
  const [loading, setLoading] = createSignal(true);
  const [reloading, setReloading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const statusFromServer = (server: McpServer): McpConnectionStatus => {
    const raw = server.status ?? {};
    const tools = typeof raw.tools === 'number' ? raw.tools : 0;
    const connected = server.valid === false ? false : Boolean(raw.connected);
    const errorValue = server.error ?? (typeof raw.error === 'string' ? raw.error : undefined);
    return {
      name: server.name,
      connected,
      transport: server.transport ?? 'stdio',
      tools,
      error: errorValue ?? undefined,
      disabled: Boolean(raw.disabled),
      status: typeof raw.status === 'string' ? raw.status : undefined,
    };
  };

  const applyServers = (items: McpServer[]) => {
    setServers(items);
    const statusesMap = new Map<string, McpConnectionStatus>();
    for (const server of items) {
      statusesMap.set(server.name, statusFromServer(server));
    }
    setStatuses(statusesMap);
  };

  const updateServerDesktop = (name: string, desktop: NonNullable<McpServer['desktop']>) => {
    setServers((prev) => prev.map((server) => (
      server.name === name ? { ...server, desktop } : server
    )));
  };

  const setToolsLoadingFor = (name: string, value: boolean) => {
    setToolsLoading((prev) => {
      const next = new Set(prev);
      if (value) next.add(name);
      else next.delete(name);
      return next;
    });
  };

  const setToolsErrorFor = (name: string, message: string | null) => {
    setToolsError((prev) => {
      const next = new Map(prev);
      if (message) next.set(name, message);
      else next.delete(name);
      return next;
    });
  };

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await api.mcp().list();
      applyServers(list.items);
      const names = new Set(list.items.map((server) => server.name));
      setServerTools((prev) => new Map([...prev].filter(([name]) => names.has(name))));
      setToolsError((prev) => new Map([...prev].filter(([name]) => names.has(name))));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load MCP servers');
      setServers([]);
      setStatuses(new Map());
      setServerTools(new Map());
      setToolsError(new Map());
    } finally {
      setLoading(false);
    }
  };

  onMount(async () => {
    await refresh();
  });

  const loadTools = async (name: string, options: { force?: boolean } = {}) => {
    if (!options.force && serverTools().has(name)) return;
    if (toolsLoading().has(name)) return;
    setToolsLoadingFor(name, true);
    setToolsErrorFor(name, null);
    try {
      const response = await api.mcp().tools(name);
      const status = response.status ?? {};
      const tools = typeof status.tools === 'number' ? status.tools : response.items.length;
      setServerTools((prev) => {
        const next = new Map(prev);
        next.set(name, response.items);
        return next;
      });
      setStatuses((prev) => {
        const next = new Map(prev);
        const current = next.get(name);
        next.set(name, {
          name,
          connected: Boolean(status.connected),
          transport: current?.transport ?? 'stdio',
          tools,
          error: typeof status.error === 'string' ? status.error : undefined,
          disabled: Boolean(status.disabled),
          status: typeof status.status === 'string' ? status.status : current?.status,
        });
        return next;
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to load tools';
      setToolsErrorFor(name, message);
      setStatuses((prev) => {
        const next = new Map(prev);
        const current = next.get(name);
        next.set(name, {
          name,
          connected: false,
          transport: current?.transport ?? 'stdio',
          tools: 0,
          error: message,
          disabled: current?.disabled,
          status: current?.status,
        });
        return next;
      });
    } finally {
      setToolsLoadingFor(name, false);
    }
  };

  const handleSelectServer = (name: string) => {
    setSelectedName(name);
    void api.mcp().patchDesktop(name, { last_selected_at: new Date().toISOString() })
      .then((desktop) => updateServerDesktop(name, desktop))
      .catch(() => undefined);
    void loadTools(name);
  };

  const handleReload = async () => {
    setReloading(true);
    setError(null);
    try {
      const response = await api.mcp().reload();
      applyServers(response.items);
      setServerTools(new Map());
      setToolsError(new Map());
      const name = selectedName();
      if (name && response.items.some((server) => server.name === name)) {
        await loadTools(name, { force: true });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to reload MCP');
    } finally {
      setReloading(false);
    }
  };

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

  const selectedToolsLoading = createMemo((): boolean => {
    const name = selectedName();
    return name ? toolsLoading().has(name) : false;
  });

  const selectedToolsError = createMemo((): string | null => {
    const name = selectedName();
    return name ? toolsError().get(name) ?? null : null;
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

    setError(null);
    try {
      await api.mcp().add(newServer);
      setShowAddForm(false);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to add MCP server');
    }
  };

  const handleDeleteServer = async (name: string) => {
    setError(null);
    try {
      await api.mcp().remove(name);
      setServers((prev) => prev.filter((s) => s.name !== name));
      setStatuses((prev) => {
        const next = new Map(prev);
        next.delete(name);
        return next;
      });
      setServerTools((prev) => {
        const next = new Map(prev);
        next.delete(name);
        return next;
      });
      setToolsErrorFor(name, null);
      if (selectedName() === name) {
        setSelectedName(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to remove MCP server');
    }
  };

  const handleTogglePin = async (name: string, pinned: boolean) => {
    setError(null);
    try {
      const desktop = await api.mcp().patchDesktop(name, { pinned });
      updateServerDesktop(name, desktop);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update MCP server');
    }
  };

  return (
    <div class={styles.mcpView}>
      <div class={styles.toolbar}>
        <h2 class={styles.title}>MCP Servers</h2>
        <div class={styles.toolbarActions}>
          <Button
            variant="secondary"
            size="sm"
            disabled={reloading()}
            onClick={() => void handleReload()}
          >
            {reloading() ? 'Reloading...' : 'Reload MCP'}
          </Button>
          <Button variant="primary" size="sm" onClick={() => setShowAddForm(true)}>
            + Add Server
          </Button>
        </div>
      </div>

      <div class={styles.content}>
        <Show when={error()}>
          {(message) => <div class={styles.errorBanner}>{message()}</div>}
        </Show>
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
              onSelect={handleSelectServer}
              onDelete={handleDeleteServer}
              onTogglePin={(name, pinned) => void handleTogglePin(name, pinned)}
            />
          </div>
          <Show when={selectedServer()}>
            {(server) => (
              <div class={styles.detailPanel}>
                <ServerDetail
                  server={server()}
                  status={selectedStatus()}
                  tools={selectedTools()}
                  toolsLoading={selectedToolsLoading()}
                  toolsError={selectedToolsError()}
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
