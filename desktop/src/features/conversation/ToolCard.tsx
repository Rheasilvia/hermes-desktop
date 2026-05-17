import type { Component } from 'solid-js';
import { Show } from 'solid-js';
import { Icon } from '@/ui/atoms/Icon';
import type { IconName } from '@/ui/atoms/Icon';
import styles from './ToolCard.module.css';

type ToolStatus = 'running' | 'complete' | 'error';

interface ToolCardProps {
  name: string;
  iconName?: IconName;
  args?: string;
  result?: string;
  status?: ToolStatus;
}

const TOOL_ICONS: Record<string, IconName> = {
  web_search: 'search',
  terminal: 'zap',
  file_read: 'copy',
  file_write: 'copy',
  file_search: 'search',
  execute_code: 'zap',
  browser_navigate: 'radio',
  delegate: 'user',
};

function getToolIcon(name: string): IconName {
  if (name in TOOL_ICONS) return TOOL_ICONS[name];
  return 'wrench';
}

function formatArgs(argsStr: string): string {
  try {
    const parsed = JSON.parse(argsStr);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return argsStr;
  }
}

export const ToolCard: Component<ToolCardProps> = (props) => {
  const icon = () => props.iconName ?? getToolIcon(props.name);
  const status = () => props.status ?? 'running';

  return (
    <div class={styles.wrapper}>
      <div class={styles.header}>
        <Icon name={icon()} size={14} class={styles.toolIcon} />
        <span class={styles.name}>{props.name}</span>
        <span class={`${styles.statusDot} ${styles[status()]}`} />
      </div>
      <Show when={props.args}>
        <div>
          <div class={styles.sectionLabel}>Arguments</div>
          <pre class={styles.argsSection}>{formatArgs(props.args!)}</pre>
        </div>
      </Show>
      <Show when={props.result}>
        <div>
          <div class={styles.sectionLabel}>Result</div>
          <pre class={styles.resultSection}>{props.result}</pre>
        </div>
      </Show>
    </div>
  );
};
