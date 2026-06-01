import type { Component } from 'solid-js';
import { For, Show, createSignal } from 'solid-js';
import { settingsStore } from '@/stores/settings.js';
import { ConfigField } from '../ConfigField.js';
import { Button } from '@/ui/atoms/Button.js';
import { Input } from '@/ui/atoms/Input.js';
import { Pill } from '@/ui/atoms/Pill.js';
import styles from './SecurityTab.module.css';

export const SecurityTab: Component = () => {
  const config = () => settingsStore.config;
  const security = () => config()?.security;

  const [newCommand, setNewCommand] = createSignal('');

  const handleChange = (key: string, value: unknown) => {
    settingsStore.markDirty();
    settingsStore.saveConfig(key, value);
  };

  const addDangerousCommand = () => {
    const cmd = newCommand().trim();
    if (!cmd) return;
    const current = security()?.dangerous_commands ?? [];
    if (!current.includes(cmd)) {
      handleChange('security.dangerous_commands', [...current, cmd]);
    }
    setNewCommand('');
  };

  const removeDangerousCommand = (cmd: string) => {
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
        <div class={styles.commandList}>
          <For each={security()?.dangerous_commands ?? []}>
            {(cmd) => (
              <Pill
                onRemove={() => removeDangerousCommand(cmd)}
              >
                {cmd}
              </Pill>
            )}
          </For>
        </div>
        <div class={styles.addRow}>
          <Input
            type="text"
            value={newCommand()}
            placeholder="e.g. rm -rf"
            onChange={(e) => setNewCommand(e.currentTarget.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') addDangerousCommand(); }}
          />
          <Button size="sm" onClick={addDangerousCommand}>Add</Button>
        </div>
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
