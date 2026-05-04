import type { Component } from 'solid-js';
import { createSignal } from 'solid-js';
import { Modal } from '@/components/Modal.js';
import { Button } from '@/components/Button.js';
import { Input } from '@/components/Input.js';
import { Select } from '@/components/Select.js';
import styles from './NewSessionModal.module.css';

interface NewSessionModalProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (params: { model?: string; system_prompt?: string }) => Promise<void>;
}

const MODEL_OPTIONS = [
  { value: 'anthropic/claude-sonnet-4-20250514', label: 'Claude Sonnet 4' },
  { value: 'anthropic/claude-opus-4.6', label: 'Claude Opus 4.6' },
  { value: 'openai/gpt-4o', label: 'GPT-4o' },
  { value: 'openrouter/auto', label: 'OpenRouter Auto' },
];

export const NewSessionModal: Component<NewSessionModalProps> = (props) => {
  const [model, setModel] = createSignal('anthropic/claude-sonnet-4-20250514');
  const [systemPrompt, setSystemPrompt] = createSignal('');
  const [isCreating, setIsCreating] = createSignal(false);

  const handleSubmit = async () => {
    setIsCreating(true);
    try {
      await props.onSubmit({
        model: model(),
        system_prompt: systemPrompt() || undefined,
      });
    } finally {
      setIsCreating(false);
      setSystemPrompt('');
      setModel('anthropic/claude-sonnet-4-20250514');
    }
  };

  return (
    <Modal
      open={props.open}
      title="New Session"
      onClose={props.onClose}
      footer={
        <div class={styles.footer}>
          <Button variant="ghost" onClick={props.onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleSubmit}
            disabled={isCreating()}
          >
            {isCreating() ? 'Creating...' : 'Create Session'}
          </Button>
        </div>
      }
    >
      <div class={styles.form}>
        <div class={styles.field}>
          <label class={styles.label}>Model</label>
          <Select
            options={MODEL_OPTIONS}
            value={model()}
            onChange={setModel}
          />
        </div>
        <div class={styles.field}>
          <label class={styles.label}>System Prompt (optional)</label>
          <Input
            value={systemPrompt()}
            placeholder="Custom instructions for this session..."
            onChange={setSystemPrompt}
          />
        </div>
      </div>
    </Modal>
  );
};
