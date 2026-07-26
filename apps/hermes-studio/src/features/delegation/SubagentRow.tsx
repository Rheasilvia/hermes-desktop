import type { Component } from 'solid-js';
import { Show } from 'solid-js';
import type { SubagentRecord } from '@/types/gateway.js';
import { delegationStore } from '@/stores/delegation.js';
import { Icon, type IconName } from '@/ui/atoms/Icon.js';
import { ActionRow, StatusBadge, type StatusBadgeTone } from '@/features/conversation/shared/index.js';
import styles from './DelegationSidePanel.module.css';

function statusIcon(status: SubagentRecord['status']): IconName {
  switch (status) {
    case 'running': return 'loader';
    case 'complete': return 'check-circle';
    case 'error': return 'alert-circle';
    case 'paused': return 'square';
    default: return 'cpu';
  }
}

function statusTone(status: SubagentRecord['status']): StatusBadgeTone {
  switch (status) {
    case 'running': return 'running';
    case 'complete': return 'success';
    case 'error': return 'error';
    case 'paused': return 'warning';
    default: return 'idle';
  }
}

function metaFor(subagent: SubagentRecord): string {
  const parts = [subagent.subagent_id.slice(0, 8)];
  if (subagent.model) parts.push(subagent.model);
  if (subagent.task_count != null) parts.push(`Task ${subagent.task_index ?? 0}/${subagent.task_count}`);
  if (subagent.tool_count != null && subagent.tool_count > 0) parts.push(`${subagent.tool_count} tools`);
  if (subagent.duration_seconds != null) parts.push(`${subagent.duration_seconds.toFixed(1)}s`);
  if (subagent.cost_usd != null && subagent.cost_usd > 0) parts.push(`$${subagent.cost_usd.toFixed(4)}`);
  return parts.join(' · ');
}

function previewFor(subagent: SubagentRecord): string | undefined {
  return subagent.error_text ?? subagent.tool_preview ?? subagent.summary;
}

interface SubagentRowProps {
  subagent: SubagentRecord;
  hasChildren: boolean;
}

export const SubagentRow: Component<SubagentRowProps> = (props) => (
  <div
    class={styles.rowCard}
    role="treeitem"
    aria-level={(props.subagent.depth ?? 0) + 1}
    aria-expanded={props.hasChildren}
    tabindex={-1}
    style={{ 'margin-left': `${(props.subagent.depth ?? 0) * 16}px` }}
  >
    <ActionRow
      icon={statusIcon(props.subagent.status)}
      title={props.subagent.goal}
      meta={metaFor(props.subagent)}
      preview={previewFor(props.subagent)}
      trailing={
        <>
          <StatusBadge label={props.subagent.status} tone={statusTone(props.subagent.status)} />
          <Show when={props.subagent.status === 'running'}>
            <button
              type="button"
              class={styles.rowActionBtn}
              disabled={Boolean(delegationStore.interruptPendingById[props.subagent.subagent_id])}
              onClick={() => void delegationStore.interruptSubagent(props.subagent.subagent_id)}
              aria-label={`Interrupt ${props.subagent.goal}`}
            >
              <Icon name={delegationStore.interruptPendingById[props.subagent.subagent_id] ? 'loader' : 'square'} size={12} />
            </button>
          </Show>
        </>
      }
    />
  </div>
);
