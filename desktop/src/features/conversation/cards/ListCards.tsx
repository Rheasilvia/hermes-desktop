import { createResource, type Component } from 'solid-js';
import { getGateway } from '@/stores/context.js';
import { Pill } from '@/ui/atoms/Pill.js';
import { ChatCard } from './ChatCard.js';
import { CardList, CardRow, type ListState } from './CardList.js';
import type { CardComponentProps } from './types.js';
import styles from './cards.module.css';

/** Map a SolidJS resource to the archetype's loading/error/items state. */
function asState<T>(res: { (): T[] | undefined; loading: boolean; error: unknown }): ListState<T> {
  return {
    loading: res.loading,
    error: res.error ? (res.error instanceof Error ? res.error.message : String(res.error)) : null,
    items: res() ?? [],
  };
}

export const ToolsCard: Component<CardComponentProps> = (props) => {
  const [data, { refetch }] = createResource(() => getGateway()?.tools.list() ?? []);
  return (
    <ChatCard title="Tools" icon="wrench" onClose={props.onDismiss}>
      <CardList state={asState(data)} empty="No tools registered." onRetry={refetch}>
        {(t) => (
          <CardRow>
            <div class={styles.topRow}>
              <span class={styles.itemTitle}>{t.name}</span>
              <Pill variant="secondary">{t.toolset}</Pill>
            </div>
            {t.description ? <p class={styles.itemPreview}>{t.description}</p> : null}
          </CardRow>
        )}
      </CardList>
    </ChatCard>
  );
};

export const SkillsCard: Component<CardComponentProps> = (props) => {
  const [data, { refetch }] = createResource(() => getGateway()?.skills.list() ?? []);
  return (
    <ChatCard title="Skills" icon="zap" onClose={props.onDismiss}>
      <CardList state={asState(data)} empty="No skills available." onRetry={refetch}>
        {(s) => (
          <CardRow>
            <div class={styles.topRow}>
              <span class={styles.itemTitle}>{s.name}</span>
              <span class={styles.itemMeta}>
                <Pill variant="secondary">{s.category}</Pill>
                {s.enabled ? '' : 'disabled'}
              </span>
            </div>
            {s.description ? <p class={styles.itemPreview}>{s.description}</p> : null}
          </CardRow>
        )}
      </CardList>
    </ChatCard>
  );
};

export const CronCard: Component<CardComponentProps> = (props) => {
  const [data, { refetch }] = createResource(() => getGateway()?.cron.list() ?? []);
  return (
    <ChatCard title="Scheduled jobs" icon="clock" onClose={props.onDismiss}>
      <CardList state={asState(data)} empty="No scheduled jobs." onRetry={refetch}>
        {(j) => (
          <CardRow>
            <div class={styles.topRow}>
              <span class={styles.itemTitle}>{j.name}</span>
              <span class={styles.itemMeta}>{j.schedule_display}</span>
            </div>
            <p class={styles.itemPreview}>{j.prompt}</p>
          </CardRow>
        )}
      </CardList>
    </ChatCard>
  );
};

export const PluginsCard: Component<CardComponentProps> = (props) => {
  const [data, { refetch }] = createResource(() => getGateway()?.mcp.list() ?? []);
  return (
    <ChatCard title="MCP plugins" icon="plug" onClose={props.onDismiss}>
      <CardList state={asState(data)} empty="No MCP servers configured." onRetry={refetch}>
        {(m) => (
          <CardRow>
            <div class={styles.topRow}>
              <span class={styles.itemTitle}>{m.name}</span>
            </div>
            <p class={styles.itemPreview}>{m.url || m.command || ''}</p>
          </CardRow>
        )}
      </CardList>
    </ChatCard>
  );
};

export const MemoryCard: Component<CardComponentProps> = (props) => {
  const [data, { refetch }] = createResource(() => getGateway()?.memory.projects() ?? []);
  return (
    <ChatCard title="Memory · projects" icon="brain" onClose={props.onDismiss}>
      <CardList state={asState(data)} empty="No projects with memory yet." onRetry={refetch}>
        {(p) => (
          <CardRow>
            <div class={styles.topRow}>
              <span class={styles.itemTitle}>{p.workspace_path}</span>
              <span class={styles.itemMeta}>{p.session_count} session{p.session_count !== 1 ? 's' : ''}</span>
            </div>
          </CardRow>
        )}
      </CardList>
    </ChatCard>
  );
};

export const AgentsCard: Component<CardComponentProps> = (props) => {
  const [data, { refetch }] = createResource(async () => (await getGateway()?.delegation.status())?.active ?? []);
  return (
    <ChatCard title="Active agents" icon="users" onClose={props.onDismiss}>
      <CardList state={asState(data)} empty="No active subagents." onRetry={refetch}>
        {(a) => (
          <CardRow>
            <div class={styles.topRow}>
              <span class={styles.itemTitle}>{a.goal}</span>
              <Pill variant="secondary">{a.status}</Pill>
            </div>
            {a.model ? <p class={styles.itemPreview}>{a.model}</p> : null}
          </CardRow>
        )}
      </CardList>
    </ChatCard>
  );
};

export const HelpCard: Component<CardComponentProps> = (props) => {
  const [data, { refetch }] = createResource(() => getGateway()?.complete.slash({ partial: '' }) ?? []);
  return (
    <ChatCard title="Commands" icon="terminal" onClose={props.onDismiss}>
      <CardList state={asState(data)} empty="No commands available." onRetry={refetch}>
        {(c) => (
          <CardRow>
            <div class={styles.topRow}>
              <span class={styles.itemTitle}>/{c.command}</span>
              {c.category ? <Pill variant="secondary">{c.category}</Pill> : null}
            </div>
            <p class={styles.itemPreview}>{c.description}</p>
          </CardRow>
        )}
      </CardList>
    </ChatCard>
  );
};
