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

const MOCK_STATUSES: McpConnectionStatus[] = [
  { name: 'filesystem', connected: true, transport: 'stdio', tools: 12 },
  { name: 'github', connected: true, transport: 'http', tools: 24 },
  { name: 'brave-search', connected: false, transport: 'streamable_http', tools: 8, error: 'Connection timeout' },
  { name: 'postgresql', connected: true, transport: 'http', tools: 18 },
];

const MOCK_TOOLS_MAP: Record<string, McpTool[]> = {
  filesystem: [
    { name: 'read_directory', description: 'List directory contents' },
    { name: 'read_file', description: 'Read file contents' },
    { name: 'write_file', description: 'Write content to a file' },
    { name: 'search_files', description: 'Search files by name pattern' },
    { name: 'move_file', description: 'Move or rename a file' },
  ],
  github: [
    { name: 'create_issue', description: 'Create a new issue in a repository' },
    { name: 'get_pull_request', description: 'Fetch details of a specific pull request' },
    { name: 'list_issues', description: 'List and filter repository issues' },
    { name: 'create_branch', description: 'Create a new branch' },
    { name: 'push_files', description: 'Push multiple files in a commit' },
  ],
  'brave-search': [
    { name: 'brave_web_search', description: 'Search the web using Brave' },
    { name: 'brave_local_search', description: 'Search for local businesses' },
  ],
  postgresql: [
    { name: 'query', description: 'Execute a SQL query' },
    { name: 'list_tables', description: 'List all tables in the database' },
    { name: 'describe_table', description: 'Get schema for a table' },
  ],
};

const MOCK_HISTORY: Record<string, HistoryEntry[]> = {
  filesystem: [
    { ok: true, event: 'Connected — 12 tools discovered — 10:42 AM', timestamp: '10:42 AM' },
    { ok: true, event: 'Configured — Server added — 10:25 AM', timestamp: '10:25 AM' },
  ],
  github: [
    { ok: true, event: 'Connected — 24 tools discovered — 10:42 AM', timestamp: '10:42 AM' },
    { ok: false, event: 'Failed — Connection timeout — 10:38 AM', timestamp: '10:38 AM' },
    { ok: true, event: 'Connected — 24 tools discovered — 10:30 AM', timestamp: '10:30 AM' },
    { ok: true, event: 'Configured — Server added — 10:25 AM', timestamp: '10:25 AM' },
  ],
  'brave-search': [
    { ok: false, event: 'Failed — Connection refused — 11:15 AM', timestamp: '11:15 AM' },
    { ok: true, event: 'Connected — 8 tools discovered — 10:50 AM', timestamp: '10:50 AM' },
  ],
  postgresql: [
    { ok: true, event: 'Connected — 18 tools discovered — 09:30 AM', timestamp: '09:30 AM' },
    { ok: true, event: 'Configured — Server added — 09:20 AM', timestamp: '09:20 AM' },
  ],
};

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
        const mockList = list.length > 0 ? list : [
          { name: 'filesystem', command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'], transport: 'stdio' as const },
          { name: 'github', url: 'https://api.github.com/mcp', headers: { Authorization: 'Bearer ghp_***' }, transport: 'http' as const },
          { name: 'brave-search', url: 'http://localhost:3000/sse', transport: 'streamable_http' as const },
          { name: 'postgresql', url: 'postgresql://localhost:5432/mydb', transport: 'http' as const },
        ];
        setServers(mockList);
        setStatuses(new Map(MOCK_STATUSES.map((s) => [s.name, s])));
        setServerTools(new Map(Object.entries(MOCK_TOOLS_MAP)));
      } catch {
        setServers([
          { name: 'filesystem', command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'], transport: 'stdio' },
          { name: 'github', url: 'https://api.github.com/mcp', headers: { Authorization: 'Bearer ghp_***' }, transport: 'http' },
          { name: 'brave-search', url: 'http://localhost:3000/sse', transport: 'streamable_http' },
          { name: 'postgresql', url: 'postgresql://localhost:5432/mydb', transport: 'http' },
        ]);
        setStatuses(new Map(MOCK_STATUSES.map((s) => [s.name, s])));
        setServerTools(new Map(Object.entries(MOCK_TOOLS_MAP)));
      }
    } else {
      setServers([
        { name: 'filesystem', command: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'], transport: 'stdio' },
        { name: 'github', url: 'https://api.github.com/mcp', headers: { Authorization: 'Bearer ghp_***' }, transport: 'http' },
        { name: 'brave-search', url: 'http://localhost:3000/sse', transport: 'streamable_http' },
        { name: 'postgresql', url: 'postgresql://localhost:5432/mydb', transport: 'http' },
      ]);
      setStatuses(new Map(MOCK_STATUSES.map((s) => [s.name, s])));
      setServerTools(new Map(Object.entries(MOCK_TOOLS_MAP)));
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
    const name = selectedName();
    if (!name) return [];
    return MOCK_HISTORY[name] ?? [];
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
