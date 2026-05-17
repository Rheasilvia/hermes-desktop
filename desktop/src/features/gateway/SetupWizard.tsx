import type { Component } from 'solid-js';
import { createSignal, Show, For, Switch, Match } from 'solid-js';
import { Button } from '@/ui/atoms/Button.js';
import { Input } from '@/ui/atoms/Input.js';
import { Toggle } from '@/ui/atoms/Toggle.js';
import type { PlatformId } from './PlatformConfig.js';
import styles from './SetupWizard.module.css';

interface SetupWizardProps {
  open: boolean;
  onClose: () => void;
}

import type { IconName } from '@/ui/atoms/Icon.js';
import { Icon } from '@/ui/atoms/Icon.js';

interface PlatformOption {
  id: PlatformId;
  label: string;
  icon: IconName;
}

const PLATFORMS: PlatformOption[] = [
  { id: 'telegram', label: 'Telegram', icon: 'send' },
  { id: 'discord', label: 'Discord', icon: 'message-circle' },
  { id: 'slack', label: 'Slack', icon: 'smartphone' },
  { id: 'whatsapp', label: 'WhatsApp', icon: 'smartphone' },
  { id: 'signal', label: 'Signal', icon: 'lock' },
  { id: 'homeassistant', label: 'Home Assistant', icon: 'home' },
  { id: 'qqbot', label: 'QQ Bot', icon: 'terminal' },
];

const CREDENTIAL_FIELDS: Record<PlatformId, { name: string; label: string; type: 'text' | 'password'; placeholder: string }[]> = {
  telegram: [
    { name: 'bot_token', label: 'Bot Token', type: 'password', placeholder: '123456:ABC-DEF...' },
  ],
  discord: [
    { name: 'token', label: 'Bot Token', type: 'password', placeholder: 'MTk4NjIy...' },
  ],
  slack: [
    { name: 'bot_token', label: 'Bot Token', type: 'password', placeholder: 'xoxb-...' },
    { name: 'signing_secret', label: 'Signing Secret', type: 'password', placeholder: 'abcdef123456...' },
  ],
  whatsapp: [
    { name: 'phone_number_id', label: 'Phone Number ID', type: 'text', placeholder: '123456789' },
    { name: 'access_token', label: 'Access Token', type: 'password', placeholder: 'EAAx...' },
  ],
  signal: [
    { name: 'phone_number', label: 'Phone Number', type: 'text', placeholder: '+1234567890' },
    { name: 'signal_cli_path', label: 'Signal CLI Path', type: 'text', placeholder: '/usr/local/bin/signal-cli' },
  ],
  homeassistant: [
    { name: 'url', label: 'Home Assistant URL', type: 'text', placeholder: 'http://192.168.1.100:8123' },
    { name: 'access_token', label: 'Long-Lived Access Token', type: 'password', placeholder: 'eyJ0eXAiOiJKV1Q...' },
  ],
  qqbot: [
    { name: 'app_id', label: 'App ID', type: 'text', placeholder: '1012345678' },
    { name: 'app_secret', label: 'App Secret', type: 'password', placeholder: 'a1b2c3d4...' },
    { name: 'token', label: 'Token', type: 'password', placeholder: 'your-bot-token' },
  ],
};

const TOTAL_STEPS = 4;

export const SetupWizard: Component<SetupWizardProps> = (props) => {
  const [step, setStep] = createSignal(1);
  const [selectedPlatform, setSelectedPlatform] = createSignal<PlatformId | null>(null);
  const [autoStart, setAutoStart] = createSignal(true);
  const [notifyOnMessage, setNotifyOnMessage] = createSignal(false);

  const handleNext = () => {
    if (step() < TOTAL_STEPS) {
      setStep(step() + 1);
    }
  };

  const handleBack = () => {
    if (step() > 1) {
      setStep(step() - 1);
    }
  };

  const handleFinish = () => {
    setStep(1);
    setSelectedPlatform(null);
    props.onClose();
  };

  const canNext = () => {
    const s = step();
    if (s === 1) return selectedPlatform() !== null;
    return true;
  };

  return (
    <div class={styles.wizard}>
      <div class={styles.steps}>
        <For each={Array.from({ length: TOTAL_STEPS })}>
          {(_, i) => (
            <>
              <div
                classList={{
                  [styles.stepDot]: true,
                  [styles.stepDotActive]: step() === i() + 1,
                  [styles.stepDotDone]: step() > i() + 1,
                }}
              />
              <Show when={i() < TOTAL_STEPS - 1}>
                <div
                  classList={{
                    [styles.stepLine]: true,
                    [styles.stepLineDone]: step() > i() + 1,
                  }}
                />
              </Show>
            </>
          )}
        </For>
      </div>

      <div class={styles.stepContent}>
        <Switch>
          <Match when={step() === 1}>
            <h3 class={styles.stepTitle}>Choose a Platform</h3>
            <div class={styles.platformGrid}>
              <For each={PLATFORMS}>
                {(p) => (
                  <button
                    type="button"
                    classList={{
                      [styles.platformOption]: true,
                      [styles.platformOptionSelected]: selectedPlatform() === p.id,
                    }}
                    onClick={() => setSelectedPlatform(p.id)}
                  >
                    <span class={styles.platformIcon}>
                      <Icon name={p.icon} size={20} strokeWidth={1.5} />
                    </span>
                    <span>{p.label}</span>
                  </button>
                )}
              </For>
            </div>
          </Match>

          <Match when={step() === 2}>
            <h3 class={styles.stepTitle}>Enter Credentials</h3>
            <Show when={selectedPlatform()} keyed>
              {(platform) => (
                <div class={styles.formFields}>
                  <For each={CREDENTIAL_FIELDS[platform]}>
                    {(field) => (
                      <Input
                        label={field.label}
                        type={field.type}
                        placeholder={field.placeholder}
                      />
                    )}
                  </For>
                </div>
              )}
            </Show>
          </Match>

          <Match when={step() === 3}>
            <h3 class={styles.stepTitle}>Configure Options</h3>
            <div class={styles.formFields}>
              <Toggle
                checked={autoStart()}
                label="Auto-start on application launch"
                onChange={setAutoStart}
              />
              <Toggle
                checked={notifyOnMessage()}
                label="Show desktop notifications for new messages"
                onChange={setNotifyOnMessage}
              />
              <Input
                label="Working Directory"
                type="text"
                placeholder="/home/user/projects"
              />
            </div>
          </Match>

          <Match when={step() === 4}>
            <div class={styles.resultSection}>
              <span class={styles.resultIcon}>
                <Icon name="check-circle" size={32} strokeWidth={1.5} />
              </span>
              <h3 class={styles.resultTitle}>Configuration Complete</h3>
              <p class={styles.resultDescription}>
                Your platform has been configured successfully.
                You can now send and receive messages through this integration.
              </p>
            </div>
          </Match>
        </Switch>
      </div>

      <div class={styles.footer}>
        <Show when={step() > 1}>
          <Button variant="ghost" size="md" onClick={handleBack}>
            Back
          </Button>
        </Show>
        <Show when={step() === 1}>
          <div />
        </Show>
        <Show when={step() < TOTAL_STEPS}>
          <Button variant="primary" size="md" disabled={!canNext()} onClick={handleNext}>
            Next
          </Button>
        </Show>
        <Show when={step() === TOTAL_STEPS}>
          <Button variant="primary" size="md" onClick={handleFinish}>
            Finish
          </Button>
        </Show>
      </div>
    </div>
  );
};
