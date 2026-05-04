import type { Component } from 'solid-js';
import { createSignal, Show } from 'solid-js';
import { Button } from '@/components/Button.js';
import { Input } from '@/components/Input.js';
import styles from './CustomEndpoint.module.css';

export interface CustomEndpointProps {
  onSave: (endpoint: { name: string; baseUrl: string; apiKey: string }) => void;
}

export const CustomEndpoint: Component<CustomEndpointProps> = (props) => {
  const [isOpen, setIsOpen] = createSignal(false);
  const [name, setName] = createSignal('');
  const [baseUrl, setBaseUrl] = createSignal('');
  const [apiKey, setApiKey] = createSignal('');
  const [nameError, setNameError] = createSignal('');
  const [urlError, setUrlError] = createSignal('');

  const toggle = () => setIsOpen((prev) => !prev);

  const resetForm = () => {
    setName('');
    setBaseUrl('');
    setApiKey('');
    setNameError('');
    setUrlError('');
  };

  const validate = (): boolean => {
    let valid = true;
    if (!name().trim()) {
      setNameError('Name is required');
      valid = false;
    } else {
      setNameError('');
    }
    if (!baseUrl().trim()) {
      setUrlError('Base URL is required');
      valid = false;
    } else if (!baseUrl().startsWith('http')) {
      setUrlError('Must start with http:// or https://');
      valid = false;
    } else {
      setUrlError('');
    }
    return valid;
  };

  const handleSave = () => {
    if (!validate()) return;
    props.onSave({
      name: name().trim(),
      baseUrl: baseUrl().trim(),
      apiKey: apiKey().trim(),
    });
    resetForm();
    setIsOpen(false);
  };

  return (
    <div class={styles.wrapper}>
      <Button variant="secondary" size="sm" onClick={toggle}>
        {isOpen() ? 'Cancel' : '+ Add Custom Endpoint'}
      </Button>
      <Show when={isOpen()}>
        <div class={styles.form}>
          <Input
            label="Name"
            placeholder="my-provider"
            value={name()}
            error={nameError()}
            onInput={(e) => setName((e.target as HTMLInputElement).value)}
          />
          <Input
            label="Base URL"
            placeholder="https://api.example.com/v1"
            value={baseUrl()}
            error={urlError()}
            onInput={(e) => setBaseUrl((e.target as HTMLInputElement).value)}
          />
          <Input
            label="API Key"
            placeholder="sk-..."
            type="password"
            value={apiKey()}
            onInput={(e) => setApiKey((e.target as HTMLInputElement).value)}
          />
          <div class={styles.actions}>
            <Button variant="primary" size="sm" onClick={handleSave}>
              Save Endpoint
            </Button>
          </div>
        </div>
      </Show>
    </div>
  );
};
