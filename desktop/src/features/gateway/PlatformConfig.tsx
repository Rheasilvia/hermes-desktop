import type { Component } from 'solid-js';
import { For, Show } from 'solid-js';
import { Input } from '@/ui/atoms/Input.js';
import { Toggle } from '@/ui/atoms/Toggle.js';
import { Button } from '@/ui/atoms/Button.js';
import { PLATFORM_DEFS } from '@/domains/gateway/platformRegistry.js';
import styles from './PlatformConfig.module.css';

export type { PlatformId, PlatformField } from '@/domains/gateway/platformRegistry.js';
import type { PlatformId } from '@/domains/gateway/platformRegistry.js';

interface PlatformConfigProps {
  platform: PlatformId;
  enabled: boolean;
  onEnabledChange: (value: boolean) => void;
}

export const PlatformConfig: Component<PlatformConfigProps> = (props) => {
  const platformDef = () => PLATFORM_DEFS[props.platform];

  return (
    <div class={styles.form}>
      <Toggle
        checked={props.enabled}
        label="Enabled"
        onChange={props.onEnabledChange}
      />

      <For each={platformDef().sections}>
        {(section) => (
          <div class={styles.section}>
            <h4 class={styles.sectionTitle}>{section.title}</h4>
            <For each={section.fields}>
              {(field, idx) => (
                <Show
                  when={idx() % 2 === 0 && idx() + 1 < section.fields.length}
                  fallback={
                    <Show when={idx() % 2 === 0} fallback={<div />}>
                      <div class={styles.fieldFull}>
                        <Input
                          label={field.label}
                          type={field.type}
                          placeholder={field.placeholder}
                        />
                      </div>
                    </Show>
                  }
                >
                  <div class={styles.fieldRow}>
                    <Input
                      label={field.label}
                      type={field.type}
                      placeholder={field.placeholder}
                    />
                    <Input
                      label={section.fields[idx() + 1].label}
                      type={section.fields[idx() + 1].type}
                      placeholder={section.fields[idx() + 1].placeholder}
                    />
                  </div>
                </Show>
              )}
            </For>
          </div>
        )}
      </For>

      <div class={styles.actions}>
        <Button variant="secondary" size="md">Reset</Button>
        <Button variant="primary" size="md">Save Configuration</Button>
      </div>
    </div>
  );
};
