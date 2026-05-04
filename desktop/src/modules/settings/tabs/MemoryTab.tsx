import type { Component } from 'solid-js';
import { settingsStore } from '@/stores/settings.js';
import { ConfigField } from '../ConfigField.js';
import styles from './GeneralTab.module.css';

export const MemoryTab: Component = () => {
  const config = () => settingsStore.config;
  const memory = () => config()?.memory;
  const compression = () => config()?.compression;

  const handleChange = (key: string, value: unknown) => {
    settingsStore.markDirty();
    settingsStore.saveConfig(key, value);
  };

  return (
    <div class={styles.tab}>
      <section class={styles.section}>
        <h3 class={styles.sectionTitle}>Memory</h3>
        <ConfigField
          label="Enable Memory"
          description="Persist memory across sessions for context recall"
          type="toggle"
          value={memory()?.enabled ?? true}
          onChange={(v) => handleChange('memory.enabled', v)}
        />
        <ConfigField
          label="Max Entries"
          description="Maximum number of memory entries to retain"
          type="number"
          value={memory()?.max_entries ?? 500}
          min={10}
          max={10000}
          onChange={(v) => handleChange('memory.max_entries', v)}
        />
      </section>

      <section class={styles.section}>
        <h3 class={styles.sectionTitle}>Context Compression</h3>
        <ConfigField
          label="Enable Compression"
          description="Auto-compress context when it exceeds the threshold"
          type="toggle"
          value={compression()?.enabled ?? true}
          onChange={(v) => handleChange('compression.enabled', v)}
        />
        <ConfigField
          label="Threshold (chars)"
          description="Character count threshold that triggers compression"
          type="number"
          value={compression()?.threshold_chars ?? 100000}
          min={1000}
          max={1000000}
          onChange={(v) => handleChange('compression.threshold_chars', v)}
        />
      </section>

      <section class={styles.section}>
        <h3 class={styles.sectionTitle}>Context Limits</h3>
        <ConfigField
          label="Max Context (chars)"
          description="Maximum context window size in characters"
          type="number"
          value={config()?.context?.max_chars ?? 200000}
          min={10000}
          max={1000000}
          onChange={(v) => handleChange('context.max_chars', v)}
        />
      </section>
    </div>
  );
};
