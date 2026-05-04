import type { Component } from 'solid-js';
import { Show, For } from 'solid-js';
import { Toggle } from '@/components/Toggle.js';
import { Pill } from '@/components/Pill.js';
import { Icon } from '@/components/Icon.js';
import type { IconName } from '@/components/Icon.js';
import styles from './SkillDetail.module.css';

export interface SkillDetailData {
  name: string;
  icon: IconName;
  category: string;
  description: string;
  instructions: string;
  prerequisites: string[];
  inputSchema: string;
  outputSchema: string;
  enabled: boolean;
  confidence: number;
}

interface SkillDetailProps {
  skill: SkillDetailData | null;
  onClose: () => void;
  onToggle: (enabled: boolean) => void;
}

export const SkillDetail: Component<SkillDetailProps> = (props) => {
  return (
    <Show when={props.skill}>
      {(skill) => (
        <div class={styles.panel}>
          <div class={styles.panelHeader}>
            <div class={styles.panelHeaderInfo}>
              <span class={styles.panelIcon}>
                <Icon name={skill().icon} size={20} strokeWidth={1.5} />
              </span>
              <div class={styles.panelTitleGroup}>
                <div class={styles.panelTitle}>{skill().name}</div>
                <Pill variant="secondary">{skill().category}</Pill>
              </div>
            </div>
            <button
              class={styles.closeBtn}
              type="button"
              onClick={props.onClose}
              aria-label="Close detail panel"
            >
              <Icon name="x" size={16} strokeWidth={2} />
            </button>
          </div>

          <div class={styles.panelBody}>
            <div class={styles.section}>
              <div class={styles.sectionTitle}>Instructions</div>
              <div class={styles.sectionContent}>{skill().instructions}</div>
            </div>

            <div class={styles.section}>
              <div class={styles.sectionTitle}>Prerequisites</div>
              <div class={styles.checklist}>
                <For each={skill().prerequisites}>
                  {(item) => (
                    <div class={styles.checkItem}>
                      <span class={styles.checkIcon}>
                        <Icon name="check" size={14} strokeWidth={2} />
                      </span>
                      {item}
                    </div>
                  )}
                </For>
              </div>
            </div>

            <div class={styles.section}>
              <div class={styles.sectionTitle}>Input Schema</div>
              <pre class={styles.codeBlock}>{skill().inputSchema}</pre>
            </div>

            <div class={styles.section}>
              <div class={styles.sectionTitle}>Output Schema</div>
              <pre class={styles.codeBlock}>{skill().outputSchema}</pre>
            </div>

            <div class={styles.section}>
              <div class={styles.sectionTitle}>Skill Status</div>
              <div class={styles.statusRow}>
                <span class={styles.statusLabel}>Enabled</span>
                <Toggle
                  checked={skill().enabled}
                  onChange={props.onToggle}
                />
              </div>
              <div class={styles.confidenceBar} style={{ "margin-top": "var(--space-3)" }}>
                <span class={styles.statusLabel}>Confidence</span>
                <div class={styles.confidenceTrack}>
                  <div
                    class={styles.confidenceFill}
                    style={{ width: `${skill().confidence}%` }}
                  />
                </div>
                <span class={styles.confidenceValue}>{skill().confidence}%</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </Show>
  );
};
