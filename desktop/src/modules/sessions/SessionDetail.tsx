import type { Component } from 'solid-js';
import {
  createSignal,
  createEffect,
  onMount,
  Show,
  For,
  Switch,
  Match,
} from 'solid-js';
import type { SessionListItem, SessionMeta } from '@/types/session.js';
import type { RenderedMessage } from '@/types/index.js';
import type { TextBlock, ToolCallBlock } from '@/types/ui/blocks.js';
import type { SessionInfoPayload } from '@/types/gateway.js';
import { sessionStore } from '@/stores/session.js';
import { chatStore } from '@/stores/chat.js';
import { getGateway } from '@/stores/context.js';
import { Tabs } from '@/components/Tabs.js';
import { Badge } from '@/components/Badge.js';
import { Pill } from '@/components/Pill.js';
import { Button } from '@/components/Button.js';
import { EmptyState } from '@/components/EmptyState.js';
import { LoadingSpinner } from '@/components/LoadingSpinner.js';
import { SessionSearch } from './SessionSearch.js';
import styles from './SessionDetail.module.css';

interface SessionDetailProps {
  sessionId: string;
  onBranch?: (id: string) => void;
  onResume?: (id: string) => void;
  onDelete?: (id: string) => void;
}

type DetailTab = 'overview' | 'search' | 'details' | 'branch';

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'search', label: 'Search' },
  { id: 'details', label: 'Details' },
  { id: 'branch', label: 'Branch' },
];

function formatDuration(start: string, end: string | null): string {
  const startDate = new Date(start);
  const endDate = end ? new Date(end) : new Date();
  const diffMs = endDate.getTime() - startDate.getTime();
  const minutes = Math.floor(diffMs / 60000);
  const seconds = Math.floor((diffMs % 60000) / 1000);
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

function formatCost(cost: number | null): string {
  if (cost === null) return '—';
  return `$${cost.toFixed(4)}`;
}

function formatNumber(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

function formatTimestamp(ts: string | number): string {
  const d = typeof ts === 'number' ? new Date(ts * 1000) : new Date(ts);
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export const SessionDetail: Component<SessionDetailProps> = (props) => {
  const [activeTab, setActiveTab] = createSignal<DetailTab>('overview');
  const [meta, setMeta] = createSignal<SessionMeta | null>(null);
  const [info, setInfo] = createSignal<SessionInfoPayload | null>(null);
  const [isLoadingDetail, setIsLoadingDetail] = createSignal(false);

  const session = (): SessionListItem | undefined =>
    sessionStore.sessions.find((s) => s.id === props.sessionId);

  const messages = (): RenderedMessage[] =>
    chatStore.getMessages(props.sessionId);

  onMount(() => {
    void chatStore.loadMessages(props.sessionId);
  });

  createEffect(() => {
    const id = props.sessionId;
    if (!id) return;

    setIsLoadingDetail(true);
    const gateway = getGateway();
    if (!gateway) {
      setIsLoadingDetail(false);
      return;
    }

    void (async () => {
      try {
        const [sessionInfo] = await Promise.all([
          gateway.session.info(id),
          chatStore.loadMessages(id),
        ]);
        setInfo(sessionInfo);
      } catch {
        void undefined;
      } finally {
        setIsLoadingDetail(false);
      }
    })();
  });

  const handleBranch = async () => {
    const result = await sessionStore.branchSession(props.sessionId);
    if (result) {
      props.onBranch?.(result.id);
    }
  };

  const handleResume = async () => {
    const ok = await sessionStore.resumeSession(props.sessionId);
    if (ok) {
      props.onResume?.(props.sessionId);
    }
  };

  const handleDelete = async () => {
    const ok = await sessionStore.deleteSession(props.sessionId);
    if (ok) {
      props.onDelete?.(props.sessionId);
    }
  };

  return (
    <div class={styles.container}>
      <Show
        when={session()}
        fallback={
          <EmptyState
            iconName="clipboard-list"
            title="Session not found"
            description="This session may have been deleted."
          />
        }
      >
        {(s) => (
          <>
            <div class={styles.header}>
              <div class={styles.headerInfo}>
                <h2 class={styles.title}>{s().title}</h2>
                <div class={styles.meta}>
                  <Pill variant="secondary">{s().model}</Pill>
                  <Badge status="active" label={`${s().message_count} messages`} />
                  <span class={styles.timestamp}>
                    {formatTimestamp(s().started_at)}
                  </span>
                </div>
              </div>
              <div class={styles.actions}>
                <Button variant="ghost" size="sm" onClick={handleResume}>
                  Resume
                </Button>
                <Button variant="ghost" size="sm" onClick={handleBranch}>
                  Branch
                </Button>
                <Button variant="danger" size="sm" onClick={handleDelete}>
                  Delete
                </Button>
              </div>
            </div>

            <Tabs
              tabs={TABS}
              activeTab={activeTab()}
              onChange={(id) => setActiveTab(id as DetailTab)}
            />

            <div class={styles.tabContent}>
              <Show when={!isLoadingDetail()} fallback={<LoadingSpinner size="md" label="Loading..." />}>
                <Switch>
                  <Match when={activeTab() === 'overview'}>
                    <OverviewTab session={s()} info={info()} />
                  </Match>
                  <Match when={activeTab() === 'search'}>
                    <SessionSearch messages={messages()} />
                  </Match>
                  <Match when={activeTab() === 'details'}>
                    <DetailsTab messages={messages()} />
                  </Match>
                  <Match when={activeTab() === 'branch'}>
                    <BranchTab sessionId={props.sessionId} />
                  </Match>
                </Switch>
              </Show>
            </div>
          </>
        )}
      </Show>
    </div>
  );
};

const OverviewTab: Component<{
  session: SessionListItem;
  info: SessionInfoPayload | null;
}> = (props) => {
  const usage = () => props.info?.usage;

  const model = () => props.session.model;

  const stats = () => [
    { label: 'Model', value: model() },
    { label: 'Messages', value: String(props.session.message_count) },
    { label: 'Tool Calls', value: String(props.session.tool_call_count) },
    {
      label: 'Input Tokens',
      value: usage() ? formatNumber(usage()!.input) : '—',
    },
    {
      label: 'Output Tokens',
      value: usage() ? formatNumber(usage()!.output) : '—',
    },
    {
      label: 'Total Tokens',
      value: usage() ? formatNumber(usage()!.total) : '—',
    },
    {
      label: 'Cost',
      value: usage() ? formatCost(usage()!.cost_usd ?? null) : '—',
    },
    {
      label: 'API Calls',
      value: usage() ? String(usage()!.calls) : '—',
    },
    {
      label: 'Context Usage',
      value:
        usage() && usage()!.context_percent !== undefined && usage()!.context_percent !== null
          ? `${usage()!.context_percent!.toFixed(1)}%`
          : '—',
    },
  ];

  return (
    <div class={styles.overview}>
      <div class={styles.statsGrid}>
        <For each={stats()}>
          {(stat) => (
            <div class={styles.statItem}>
              <span class={styles.statLabel}>{stat.label}</span>
              <span class={styles.statValue}>{stat.value}</span>
            </div>
          )}
        </For>
      </div>
    </div>
  );
};

const DetailsTab: Component<{ messages: RenderedMessage[] }> = (props) => {
  const [expandedIndex, setExpandedIndex] = createSignal<number | null>(null);

  const toggleExpand = (index: number) => {
    setExpandedIndex(expandedIndex() === index ? null : index);
  };

  const roleLabel = (role: string): string => {
    switch (role) {
      case 'user': return 'You';
      case 'assistant': return 'Hermes';
      case 'tool': return 'Tool';
      case 'system': return 'System';
      default: return role;
    }
  };

  return (
    <div class={styles.details}>
      <Show
        when={props.messages.length > 0}
        fallback={
          <EmptyState
            iconName="message-square"
            title="No messages"
            description="This session has no recorded messages."
          />
        }
      >
        <For each={props.messages}>
          {(msg, index) => {
            const isExpanded = () => expandedIndex() === index();
            const toolBlocks = () => msg.blocks.filter((b): b is ToolCallBlock => b.type === 'tool_call');
            const hasToolCalls = () => toolBlocks().length > 0 || msg.role === 'tool';
            const textContent = () =>
              msg.blocks
                .filter((b): b is TextBlock => b.type === 'text')
                .map((b) => b.content)
                .join('\n');

            return (
              <div class={styles.messageItem}>
                <div
                  class={styles.messageHeader}
                  onClick={() => hasToolCalls() && toggleExpand(index())}
                >
                  <span class={styles.messageRole}>{roleLabel(msg.role)}</span>
                  <span class={styles.messageTime}>
                    {formatTimestamp(msg.timestamp)}
                  </span>
                  <Show when={hasToolCalls()}>
                    <span class={styles.expandHint}>
                      {isExpanded() ? '▲' : '▼'}
                    </span>
                  </Show>
                </div>
                <div class={styles.messageContent}>
                  <Show when={textContent()} fallback={<em class={styles.emptyMsg}>(empty)</em>}>
                    {(content) => (
                      <p class={styles.contentText}>{content()}</p>
                    )}
                  </Show>
                </div>
                <Show when={hasToolCalls() && isExpanded()}>
                  <div class={styles.toolCallDetails}>
                    <Show when={msg.toolName}>
                      {(name) => (
                        <div class={styles.toolDetail}>
                          <span class={styles.toolDetailLabel}>Tool:</span>
                          <span>{name()}</span>
                        </div>
                      )}
                    </Show>
                    <For each={toolBlocks()}>
                      {(tc) => (
                        <pre class={styles.toolCallPre}>
                          {tc.inputPreview ?? '(no input)'}
                        </pre>
                      )}
                    </For>
                  </div>
                </Show>
              </div>
            );
          }}
        </For>
      </Show>
    </div>
  );
};

const BranchTab: Component<{ sessionId: string }> = (props) => {
  const branchedFrom = () =>
    sessionStore.sessions.find((s) => s.id === props.sessionId);

  const childSessions = () =>
    sessionStore.sessions.filter(
      (s) => (s as SessionListItem & { parent_session_id?: string }).parent_session_id === props.sessionId,
    );

  return (
    <div class={styles.branch}>
      <Show
        when={childSessions().length > 0}
        fallback={
          <EmptyState
            iconName="git-branch"
            title="No branches"
            description="This session has no branches yet. Use the Branch button to create one."
          />
        }
      >
        <h3 class={styles.branchTitle}>Branches</h3>
        <div class={styles.branchList}>
          <For each={childSessions()}>
            {(child) => (
              <div class={styles.branchItem}>
                <span class={styles.branchName}>{child.title}</span>
                <span class={styles.branchMeta}>
                  {child.message_count} msgs · {formatTimestamp(child.started_at)}
                </span>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
};
