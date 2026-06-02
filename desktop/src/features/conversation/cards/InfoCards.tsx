import { createResource, type Component } from 'solid-js';
import { getGateway } from '@/stores/context.js';
import { sessionStore } from '@/stores/session.js';
import { ChatCard } from './ChatCard.js';
import { CardKeyValue, type KeyValueRow } from './CardKeyValue.js';
import { AsyncBody } from './CardList.js';
import type { CardComponentProps } from './types.js';

const errOf = (e: unknown) => (e ? (e instanceof Error ? e.message : String(e)) : null);

export const StatusCard: Component<CardComponentProps> = (props) => {
  const [info, { refetch }] = createResource(() => {
    const sid = sessionStore.activeSessionId;
    return sid ? getGateway()?.session.info(sid) : undefined;
  });
  const rows = (): KeyValueRow[] => {
    const i = info();
    if (!i) return [];
    const out: KeyValueRow[] = [
      { label: 'Model', value: i.model },
      { label: 'Workspace', value: i.cwd || '—' },
    ];
    if (i.version) out.push({ label: 'Version', value: i.version });
    if (i.usage) out.push({ label: 'Tokens', value: `${i.usage.input} in / ${i.usage.output} out` });
    return out;
  };
  return (
    <ChatCard title="Session status" icon="info" onClose={props.onDismiss}>
      <AsyncBody loading={info.loading} error={errOf(info.error)} onRetry={refetch}>
        <CardKeyValue rows={rows()} />
      </AsyncBody>
    </ChatCard>
  );
};

export const ModelCard: Component<CardComponentProps> = (props) => {
  const [opts, { refetch }] = createResource(() =>
    getGateway()?.model.options(sessionStore.activeSessionId ?? undefined),
  );
  const rows = (): KeyValueRow[] => {
    const o = opts();
    if (!o) return [];
    return [
      { label: 'Provider', value: o.provider || '—' },
      { label: 'Model', value: o.model || '—' },
      { label: 'Providers', value: String(o.providers?.length ?? 0) },
    ];
  };
  return (
    <ChatCard title="Model" icon="cpu" onClose={props.onDismiss}>
      <AsyncBody loading={opts.loading} error={errOf(opts.error)} onRetry={refetch}>
        <CardKeyValue rows={rows()} />
      </AsyncBody>
    </ChatCard>
  );
};

export const ConfigCard: Component<CardComponentProps> = (props) => {
  const [cfg, { refetch }] = createResource(() => getGateway()?.config.get());
  const rows = (): KeyValueRow[] => {
    const c = cfg() as Record<string, unknown> | undefined;
    if (!c) return [];
    // Show only top-level scalar settings — nested objects belong on the page.
    return Object.entries(c)
      .filter(([, v]) => v == null || typeof v !== 'object')
      .slice(0, 12)
      .map(([label, v]) => ({ label, value: v == null ? '—' : String(v) }));
  };
  return (
    <ChatCard title="Configuration" icon="settings" onClose={props.onDismiss}>
      <AsyncBody loading={cfg.loading} error={errOf(cfg.error)} onRetry={refetch}>
        <CardKeyValue rows={rows()} />
      </AsyncBody>
    </ChatCard>
  );
};

export const PlatformsCard: Component<CardComponentProps> = (props) => {
  const state = () => getGateway()?.getConnectionState() ?? 'disconnected';
  return (
    <ChatCard title="Gateway" icon="wifi" onClose={props.onDismiss}>
      <CardKeyValue rows={[{ label: 'Connection', value: state() }]} />
    </ChatCard>
  );
};

export const UsageCard: Component<CardComponentProps> = (props) => {
  const [info, { refetch }] = createResource(() => {
    const sid = sessionStore.activeSessionId;
    return sid ? getGateway()?.session.info(sid) : undefined;
  });
  const rows = (): KeyValueRow[] => {
    const u = info()?.usage;
    if (!u) return [];
    const out: KeyValueRow[] = [
      { label: 'Input tokens', value: String(u.input) },
      { label: 'Output tokens', value: String(u.output) },
      { label: 'Total tokens', value: String(u.total) },
    ];
    if (u.cost_usd != null) out.push({ label: 'Cost', value: `$${u.cost_usd.toFixed(4)}` });
    return out;
  };
  return (
    <ChatCard title="Usage (this session)" icon="bar-chart" onClose={props.onDismiss}>
      <AsyncBody loading={info.loading} error={errOf(info.error)} onRetry={refetch}>
        <CardKeyValue rows={rows()} />
      </AsyncBody>
    </ChatCard>
  );
};
