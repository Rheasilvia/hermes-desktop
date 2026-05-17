import type { Component } from 'solid-js';
import { For, Show } from 'solid-js';
import { Input } from '@/ui/atoms/Input.js';
import { Toggle } from '@/ui/atoms/Toggle.js';
import { Button } from '@/ui/atoms/Button.js';
import styles from './PlatformConfig.module.css';

export type PlatformId =
  | 'telegram'
  | 'discord'
  | 'slack'
  | 'whatsapp'
  | 'signal'
  | 'homeassistant'
  | 'qqbot';

export interface PlatformField {
  name: string;
  label: string;
  type: 'text' | 'password';
  placeholder: string;
}

interface PlatformConfigProps {
  platform: PlatformId;
  enabled: boolean;
  onEnabledChange: (value: boolean) => void;
}

const PLATFORM_FIELDS: Record<PlatformId, { sections: { title: string; fields: PlatformField[] }[] }> = {
  telegram: {
    sections: [
      {
        title: 'Credentials',
        fields: [
          { name: 'bot_token', label: 'Bot Token', type: 'password', placeholder: '123456:ABC-DEF...' },
          { name: 'chat_id', label: 'Chat ID', type: 'text', placeholder: '-1001234567890' },
        ],
      },
      {
        title: 'Options',
        fields: [
          { name: 'allowed_users', label: 'Allowed Users', type: 'text', placeholder: 'user1, user2, user3' },
          { name: 'working_directory', label: 'Working Directory', type: 'text', placeholder: '/home/user' },
        ],
      },
    ],
  },
  discord: {
    sections: [
      {
        title: 'Credentials',
        fields: [
          { name: 'token', label: 'Bot Token', type: 'password', placeholder: 'MTk4NjIy...' },
        ],
      },
      {
        title: 'Options',
        fields: [
          { name: 'guild_id', label: 'Guild ID', type: 'text', placeholder: '123456789012345678' },
          { name: 'channel_id', label: 'Channel ID', type: 'text', placeholder: '123456789012345678' },
          { name: 'allowed_roles', label: 'Allowed Roles', type: 'text', placeholder: 'Admin, Moderator' },
        ],
      },
    ],
  },
  slack: {
    sections: [
      {
        title: 'Credentials',
        fields: [
          { name: 'bot_token', label: 'Bot Token', type: 'password', placeholder: 'xoxb-...' },
          { name: 'signing_secret', label: 'Signing Secret', type: 'password', placeholder: 'abcdef123456...' },
        ],
      },
      {
        title: 'Options',
        fields: [
          { name: 'channel', label: 'Channel', type: 'text', placeholder: '#general' },
          { name: 'allowed_users', label: 'Allowed Users', type: 'text', placeholder: 'U01ABC, U02DEF' },
        ],
      },
    ],
  },
  whatsapp: {
    sections: [
      {
        title: 'Credentials',
        fields: [
          { name: 'phone_number_id', label: 'Phone Number ID', type: 'text', placeholder: '123456789' },
          { name: 'access_token', label: 'Access Token', type: 'password', placeholder: 'EAAx...' },
          { name: 'webhook_verify_token', label: 'Webhook Verify Token', type: 'password', placeholder: 'my-verify-token' },
        ],
      },
    ],
  },
  signal: {
    sections: [
      {
        title: 'Credentials',
        fields: [
          { name: 'phone_number', label: 'Phone Number', type: 'text', placeholder: '+1234567890' },
          { name: 'signal_cli_path', label: 'Signal CLI Path', type: 'text', placeholder: '/usr/local/bin/signal-cli' },
        ],
      },
    ],
  },
  homeassistant: {
    sections: [
      {
        title: 'Connection',
        fields: [
          { name: 'url', label: 'Home Assistant URL', type: 'text', placeholder: 'http://192.168.1.100:8123' },
          { name: 'access_token', label: 'Long-Lived Access Token', type: 'password', placeholder: 'eyJ0eXAiOiJKV1Q...' },
          { name: 'entity_prefix', label: 'Entity Prefix', type: 'text', placeholder: 'sensor.hermes_' },
        ],
      },
    ],
  },
  qqbot: {
    sections: [
      {
        title: 'Credentials',
        fields: [
          { name: 'app_id', label: 'App ID', type: 'text', placeholder: '1012345678' },
          { name: 'app_secret', label: 'App Secret', type: 'password', placeholder: 'a1b2c3d4...' },
          { name: 'token', label: 'Token', type: 'password', placeholder: 'your-bot-token' },
        ],
      },
    ],
  },
};

export const PlatformConfig: Component<PlatformConfigProps> = (props) => {
  const platformDef = () => PLATFORM_FIELDS[props.platform];

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
