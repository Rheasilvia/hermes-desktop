import type { Component } from 'solid-js';
import { For, Show, createSignal } from 'solid-js';
import { settingsStore } from '@/stores/settings.js';
import { ConfigField } from '../ConfigField.js';
import { Button } from '@/components/Button.js';
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
              <div class={styles.commandItem}>
                <code class={styles.commandCode}>{cmd}</code>
                <button
                  class={styles.removeBtn}
                  type="button"
                  onClick={() => removeDangerousCommand(cmd)}
                  aria-label={`Remove ${cmd}`}
                >
                  ×
                </button>
              </div>
            )}
          </For>
        </div>
        <div class={styles.addRow}>
          <input
            class={styles.addInput}
            type="text"
            value={newCommand()}
            placeholder="e.g. rm -rf"
            onInput={(e) => setNewCommand(e.currentTarget.value)}
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
