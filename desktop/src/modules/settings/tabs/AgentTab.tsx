import type { Component } from 'solid-js';
import { settingsStore } from '@/stores/settings.js';
import { ConfigField } from '../ConfigField.js';
import styles from './GeneralTab.module.css';

const TOOLSET_OPTIONS = [
  { value: 'web', label: 'Web Search & Extract' },
  { value: 'browser', label: 'Browser Automation' },
  { value: 'code_execution', label: 'Code Execution' },
  { value: 'delegate', label: 'Subagent Delegation' },
  { value: 'mcp', label: 'MCP Integration' },
  { value: 'file', label: 'File Operations' },
  { value: 'terminal', label: 'Terminal' },
  { value: 'cron', label: 'Scheduled Tasks' },
];

const NOTIFICATION_OPTIONS = [
  { value: 'all', label: 'All (running + result)' },
  { value: 'result', label: 'Result only' },
  { value: 'error', label: 'Errors only' },
  { value: 'off', label: 'Off' },
];

export const AgentTab: Component = () => {
  const config = () => settingsStore.config;
  const agent = () => config()?.agent;
  const toolsets = () => config()?.toolsets;
  const display = () => config()?.display;

  const handleChange = (key: string, value: unknown) => {
    settingsStore.markDirty();
    settingsStore.saveConfig(key, value);
  };

  return (
    <div class={styles.tab}>
      <section class={styles.section}>
        <h3 class={styles.sectionTitle}>Agent Behavior</h3>
        <ConfigField
          label="Max Iterations"
          description="Maximum tool-calling iterations per conversation turn"
          type="number"
          value={agent()?.max_iterations ?? 90}
          min={1}
          max={200}
          onChange={(v) => handleChange('agent.max_iterations', v)}
        />
        <ConfigField
          label="Save Trajectories"
          description="Save conversation trajectories for analysis"
          type="toggle"
          value={agent()?.save_trajectories ?? false}
          onChange={(v) => handleChange('agent.save_trajectories', v)}
        />
      </section>

      <section class={styles.section}>
        <h3 class={styles.sectionTitle}>Reasoning</h3>
        <ConfigField
          label="Background Notifications"
          description="Verbosity of background process notifications"
          type="select"
          value={display()?.background_process_notifications ?? 'all'}
          options={NOTIFICATION_OPTIONS}
          onChange={(v) => handleChange('display.background_process_notifications', v)}
        />
      </section>

      <section class={styles.section}>
        <h3 class={styles.sectionTitle}>Toolsets</h3>
        <ConfigField
          label="Human Delay"
          description="Simulate human-like typing delay"
          type="toggle"
          value={config()?.human_delay?.enabled ?? false}
          onChange={(v) => handleChange('human_delay.enabled', v)}
        />
        <ConfigField
          label="Min Delay (ms)"
          description="Minimum delay between tool calls"
          type="number"
          value={config()?.human_delay?.min_ms ?? 500}
          min={0}
          max={10000}
          onChange={(v) => handleChange('human_delay.min_ms', v)}
        />
        <ConfigField
          label="Max Delay (ms)"
          description="Maximum delay between tool calls"
          type="number"
          value={config()?.human_delay?.max_ms ?? 2000}
          min={0}
          max={30000}
          onChange={(v) => handleChange('human_delay.max_ms', v)}
        />
      </section>
    </div>
  );
};
