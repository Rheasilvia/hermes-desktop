import type { IconName } from '@/ui/atoms/Icon.js';

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

export interface PlatformOption {
  id: PlatformId;
  label: string;
  icon: IconName;
}

export interface PlatformDef {
  id: PlatformId;
  label: string;
  icon: IconName;
  credentialFields: PlatformField[];
  sections: { title: string; fields: PlatformField[] }[];
}

export const PLATFORM_LIST: PlatformOption[] = [
  { id: 'telegram', label: 'Telegram', icon: 'send' },
  { id: 'discord', label: 'Discord', icon: 'message-circle' },
  { id: 'slack', label: 'Slack', icon: 'smartphone' },
  { id: 'whatsapp', label: 'WhatsApp', icon: 'smartphone' },
  { id: 'signal', label: 'Signal', icon: 'lock' },
  { id: 'homeassistant', label: 'Home Assistant', icon: 'home' },
  { id: 'qqbot', label: 'QQ Bot', icon: 'terminal' },
];

export const PLATFORM_DEFS: Record<PlatformId, PlatformDef> = {
  telegram: {
    id: 'telegram',
    label: 'Telegram',
    icon: 'send',
    credentialFields: [
      { name: 'bot_token', label: 'Bot Token', type: 'password', placeholder: '123456:ABC-DEF...' },
    ],
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
    id: 'discord',
    label: 'Discord',
    icon: 'message-circle',
    credentialFields: [
      { name: 'token', label: 'Bot Token', type: 'password', placeholder: 'MTk4NjIy...' },
    ],
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
    id: 'slack',
    label: 'Slack',
    icon: 'smartphone',
    credentialFields: [
      { name: 'bot_token', label: 'Bot Token', type: 'password', placeholder: 'xoxb-...' },
      { name: 'signing_secret', label: 'Signing Secret', type: 'password', placeholder: 'abcdef123456...' },
    ],
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
    id: 'whatsapp',
    label: 'WhatsApp',
    icon: 'smartphone',
    credentialFields: [
      { name: 'phone_number_id', label: 'Phone Number ID', type: 'text', placeholder: '123456789' },
      { name: 'access_token', label: 'Access Token', type: 'password', placeholder: 'EAAx...' },
    ],
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
    id: 'signal',
    label: 'Signal',
    icon: 'lock',
    credentialFields: [
      { name: 'phone_number', label: 'Phone Number', type: 'text', placeholder: '+1234567890' },
      { name: 'signal_cli_path', label: 'Signal CLI Path', type: 'text', placeholder: '/usr/local/bin/signal-cli' },
    ],
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
    id: 'homeassistant',
    label: 'Home Assistant',
    icon: 'home',
    credentialFields: [
      { name: 'url', label: 'Home Assistant URL', type: 'text', placeholder: 'http://192.168.1.100:8123' },
      { name: 'access_token', label: 'Long-Lived Access Token', type: 'password', placeholder: 'eyJ0eXAiOiJKV1Q...' },
    ],
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
    id: 'qqbot',
    label: 'QQ Bot',
    icon: 'terminal',
    credentialFields: [
      { name: 'app_id', label: 'App ID', type: 'text', placeholder: '1012345678' },
      { name: 'app_secret', label: 'App Secret', type: 'password', placeholder: 'a1b2c3d4...' },
      { name: 'token', label: 'Token', type: 'password', placeholder: 'your-bot-token' },
    ],
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
