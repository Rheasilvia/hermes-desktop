import type { Component } from 'solid-js';
import { onMount } from 'solid-js';
import { configStore } from '@/stores/config.js';
import { desktopSettingsStore } from '@/stores/desktop-settings.js';
import type { Settings } from '@/services/api/types.js';
import { ConfigField } from '../ConfigField.js';
import { StringListField } from '@/ui/atoms/StringListField.js';
import styles from './SecurityTab.module.css';

const DEFAULT_DESKTOP_SANDBOX: Settings['desktop_sandbox'] = {
  mode: 'workspace-write',
  network_access: 'restricted',
};

export const SecurityTab: Component = () => {
  const config = () => configStore.config;
  const security = () => config()?.security;
  const desktopSettings = () => desktopSettingsStore.settings();
  const desktopSandbox = () => desktopSettings().desktop_sandbox ?? DEFAULT_DESKTOP_SANDBOX;

  onMount(() => {
    void desktopSettingsStore.load();
  });

  const handleChange = (key: string, value: unknown) => {
    configStore.markDirty();
    configStore.saveConfig(key, value);
  };

  const handleDesktopSandboxChange = async (
    key: keyof Settings['desktop_sandbox'],
    value: Settings['desktop_sandbox'][keyof Settings['desktop_sandbox']],
  ) => {
    await desktopSettingsStore.saveDesktopSandbox({
      ...desktopSandbox(),
      [key]: value,
    });
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
          Commands matching these patterns require approval when approvals are enabled.
        </p>
        <StringListField
          values={security()?.dangerous_commands ?? []}
          onAdd={handleAddCommand}
          onRemove={handleRemoveCommand}
          placeholder="e.g. rm -rf"
        />
      </section>

      <section class={styles.section}>
        <h3 class={styles.sectionTitle}>Desktop Sandbox</h3>
        <ConfigField
          label="Mode"
          type="select"
          value={desktopSandbox().mode}
          options={[
            { value: 'workspace-write', label: 'Workspace Write' },
            { value: 'read-only', label: 'Read Only' },
          ]}
          onChange={(v) => void handleDesktopSandboxChange(
            'mode',
            v as Settings['desktop_sandbox']['mode'],
          )}
        />
        <ConfigField
          label="Network"
          type="select"
          value={desktopSandbox().network_access}
          options={[
            { value: 'restricted', label: 'Restricted' },
            { value: 'enabled', label: 'Enabled' },
          ]}
          onChange={(v) => void handleDesktopSandboxChange(
            'network_access',
            v as Settings['desktop_sandbox']['network_access'],
          )}
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
