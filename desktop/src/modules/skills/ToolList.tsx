import type { Component } from 'solid-js';
import { For, createMemo } from 'solid-js';
import type { ToolEntry } from '@/types/tool.js';
import { Toggle } from '@/components/Toggle.js';
import { Pill } from '@/components/Pill.js';
import { Icon } from '@/components/Icon.js';
import styles from './ToolList.module.css';

interface ToolListProps {
  tools: ToolEntry[];
  enabledTools: Set<string>;
  onToggle: (toolName: string, enabled: boolean) => void;
}

export const ToolList: Component<ToolListProps> = (props) => {
  const sortedTools = createMemo(() =>
    [...props.tools].sort((a, b) => a.name.localeCompare(b.name))
  );

  return (
    <div class={styles.toolList}>
      <For each={sortedTools()}>
        {(tool) => (
          <div class={styles.toolRow}>
            <span class={styles.toolEmoji}><Icon name="wrench" size={16} /></span>
            <div class={styles.toolInfo}>
              <div class={styles.toolName}>{tool.schema.name}</div>
              <div class={styles.toolDescription}>
                {tool.schema.description}
              </div>
            </div>
            <div class={styles.toolBadge}>
              <Pill variant="secondary">{tool.toolset}</Pill>
            </div>
            <Toggle
              checked={props.enabledTools.has(tool.name)}
              onChange={(checked) => props.onToggle(tool.name, checked)}
            />
          </div>
        )}
      </For>
    </div>
  );
};
