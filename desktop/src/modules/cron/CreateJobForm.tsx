import type { Component } from 'solid-js';
import { createSignal, Show } from 'solid-js';
import type { CreateCronJobParams, DeliveryKind } from '@/types/cron.js';
import { Button } from '@/components/Button.js';
import { Input } from '@/components/Input.js';
import { TextArea } from '@/components/TextArea.js';
import { Select } from '@/components/Select.js';
import { CronExpression } from './CronExpression.js';
import styles from './CreateJobForm.module.css';

const DELIVERY_OPTIONS = [
  { value: 'origin', label: 'Origin (push to platform)' },
  { value: 'local', label: 'Local (desktop only)' },
];

interface CreateJobFormProps {
  onSubmit: (params: CreateCronJobParams) => void;
  onCancel: () => void;
}

export const CreateJobForm: Component<CreateJobFormProps> = (props) => {
  const [name, setName] = createSignal('');
  const [schedule, setSchedule] = createSignal('');
  const [prompt, setPrompt] = createSignal('');
  const [deliver, setDeliver] = createSignal<DeliveryKind>('origin');
  const [model, setModel] = createSignal('');
  const [repeat, setRepeat] = createSignal('');

  const handleSubmit = (e: Event) => {
    e.preventDefault();
    const params: CreateCronJobParams = {
      name: name() || undefined,
      schedule: schedule(),
      prompt: prompt(),
      deliver: deliver(),
      model: model() || undefined,
      repeat: repeat() ? parseInt(repeat(), 10) : undefined,
    };
    props.onSubmit(params);
  };

  return (
    <form class={styles.form} onSubmit={handleSubmit}>
      <div class={styles.field}>
        <Input
          label="Job name"
          placeholder="e.g., Daily standup report"
          value={name()}
          onInput={(e) => setName(e.currentTarget.value)}
        />
      </div>

      <div class={styles.field}>
        <Input
          label="Schedule (cron expression)"
          placeholder="e.g., 0 9 * * *"
          value={schedule()}
          onInput={(e) => setSchedule(e.currentTarget.value)}
        />
        <Show when={schedule()}>
          <div class={styles.preview}>
            <CronExpression expression={schedule()} />
          </div>
        </Show>
      </div>

      <div class={styles.field}>
        <TextArea
          label="Prompt template"
          placeholder="What should the agent do when this job runs?"
          value={prompt()}
          rows={4}
          onInput={(e) => setPrompt(e.currentTarget.value)}
        />
      </div>

      <div class={styles.row}>
        <div class={styles.field}>
          <Select
            label="Delivery method"
            options={DELIVERY_OPTIONS}
            value={deliver()}
            onChange={(v) => setDeliver(v as DeliveryKind)}
          />
        </div>
        <div class={styles.field}>
          <Input
            label="Model (optional)"
            placeholder="e.g., anthropic/claude-sonnet-4"
            value={model()}
            onInput={(e) => setModel(e.currentTarget.value)}
          />
        </div>
      </div>

      <div class={styles.field}>
        <Input
          label="Repeat times (optional)"
          type="number"
          placeholder="Leave empty for unlimited"
          value={repeat()}
          onInput={(e) => setRepeat(e.currentTarget.value)}
        />
      </div>

      <div class={styles.actions}>
        <Button variant="secondary" onClick={props.onCancel} type="button">
          Cancel
        </Button>
        <Button
          variant="primary"
          type="submit"
          disabled={!schedule() || !prompt()}
        >
          Create Job
        </Button>
      </div>
    </form>
  );
};
