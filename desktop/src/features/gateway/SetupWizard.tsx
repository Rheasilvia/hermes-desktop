import type { Component } from 'solid-js';
import { createSignal, Show, For, Switch, Match } from 'solid-js';
import { Button } from '@/ui/atoms/Button.js';
import { Input } from '@/ui/atoms/Input.js';
import { Toggle } from '@/ui/atoms/Toggle.js';
import type { PlatformId } from './PlatformConfig.js';
import { PLATFORM_LIST, PLATFORM_DEFS } from '@/domains/gateway/platformRegistry.js';
import styles from './SetupWizard.module.css';

interface SetupWizardProps {
  open: boolean;
  onClose: () => void;
}

import { Icon } from '@/ui/atoms/Icon.js';

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
              <For each={PLATFORM_LIST}>
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
                  <For each={PLATFORM_DEFS[platform].credentialFields}>
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
