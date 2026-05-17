import type { Component } from 'solid-js';
import { For, createSignal, createMemo } from 'solid-js';
import { Pill } from '@/ui/atoms/Pill.js';
import { Button } from '@/ui/atoms/Button.js';
import { Icon } from '@/ui/atoms/Icon.js';
import type { IconName } from '@/ui/atoms/Icon.js';
import styles from './SkillsHub.module.css';

interface HubSkill {
  name: string;
  description: string;
  icon: IconName;
  author: string;
  category: string;
  installed: boolean;
}

interface SkillsHubProps {
  skills: HubSkill[];
  onInstall: (name: string) => void;
  onUninstall: (name: string) => void;
}

const CATEGORIES = ['All', 'Productivity', 'Development', 'Communication'];

export const SkillsHub: Component<SkillsHubProps> = (props) => {
  const [activeCategory, setActiveCategory] = createSignal('All');

  const filtered = createMemo(() => {
    const cat = activeCategory();
    if (cat === 'All') return props.skills;
    return props.skills.filter((s) => s.category === cat);
  });

  return (
    <div>
      <div class={styles.hubGrid}>
        <For each={filtered()}>
          {(skill) => (
            <div class={styles.skillCard}>
              <div class={styles.skillCardHeader}>
                <span class={styles.skillIcon}>
                  <Icon name={skill.icon} size={20} strokeWidth={1.5} />
                </span>
                <div class={styles.skillMeta}>
                  <div class={styles.skillName}>{skill.name}</div>
                  <div class={styles.skillAuthor}>by {skill.author}</div>
                </div>
              </div>
              <div class={styles.skillDescription}>{skill.description}</div>
              <div class={styles.skillFooter}>
                {skill.installed ? (
                  <span class={styles.installedBadge}>
                    <Icon name="check" size={12} strokeWidth={2} /> Installed
                  </span>
                ) : (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => props.onInstall(skill.name)}
                  >
                    Install
                  </Button>
                )}
              </div>
            </div>
          )}
        </For>
      </div>

      <div style={{ "margin-top": "var(--space-4)", "display": "flex", "gap": "var(--space-2)", "flex-wrap": "wrap" }}>
        <For each={CATEGORIES}>
          {(cat) => (
            <button
              type="button"
              onClick={() => setActiveCategory(cat)}
              style={{
                "background": activeCategory() === cat ? "var(--color-primary)" : "transparent",
                "color": activeCategory() === cat ? "var(--color-on-primary)" : "var(--color-on-surface-muted)",
                "border": "1px solid var(--color-border)",
                "padding": "var(--space-1) var(--space-3)",
                "border-radius": "var(--radius-pill)",
                "font-size": "var(--text-xs)",
                "cursor": "pointer",
                "font-family": "inherit",
              }}
            >
              {cat}
            </button>
          )}
        </For>
      </div>
    </div>
  );
};
