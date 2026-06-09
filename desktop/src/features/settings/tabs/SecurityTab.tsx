import type { Component } from 'solid-js';
import { configStore } from '@/stores/config.js';
import { ConfigField } from '../ConfigField.js';
import { StringListField } from '@/ui/atoms/StringListField.js';
import styles from './SecurityTab.module.css';

export const SecurityTab: Component = () => {
  const config = () => configStore.config;
  const security = () => config()?.security;

  const handleChange = (key: string, value: unknown) => {
    configStore.markDirty();
    configStore.saveConfig(key, value);
  };

  const handleAddCommand = (cmd: string) => {
    const current = security()?.dangerous_commands ?? [];
    handleChange('security.dangerous_commands', [...current, cmd]);
  };

  const handleRemoveCommand = (cmd: string) => {
    const current = security()?.dangerous_commands ?? [];
    handleChange('security.dangerous_commands', current.filter((c) => c !== cmd));
  };

  return (
    <div class={styles.tab}>
      <section class={styles.section}>
        <h3 class={styles.sectionTitle}>Approval Policy</h3>
        <ConfigField
          label="Approval Required"
          description="Require explicit approval before executing commands"
          type="toggle"
          value={security()?.approval_required ?? true}
          onChange={(v) => handleChange('security.approval_required', v)}
        />
      </section>

      <section class={styles.section}>
        <h3 class={styles.sectionTitle}>Dangerous Commands</h3>
        <p class={styles.helpText}>
          Commands matching these patterns will always require approval.
        </p>
        <StringListField
          values={security()?.dangerous_commands ?? []}
          onAdd={handleAddCommand}
          onRemove={handleRemoveCommand}
          placeholder="e.g. rm -rf"
        />
      </section>

      <section class={styles.section}>
        <h3 class={styles.sectionTitle}>Privacy</h3>
        <ConfigField
          label="Dry Run Mode"
          description="Preview commands without executing them"
          type="toggle"
          value={config()?.privacy?.dry_run ?? false}
          onChange={(v) => handleChange('privacy.dry_run', v)}
        />
      </section>
    </div>
  );
};
