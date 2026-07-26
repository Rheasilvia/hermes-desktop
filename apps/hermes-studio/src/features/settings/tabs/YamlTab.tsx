import type { Component } from 'solid-js';
import { createSignal, createEffect, Show } from 'solid-js';
import YAML from 'yaml';
import { configStore } from '@/stores/config.js';
import { Button } from '@/ui/atoms/Button.js';
import styles from './YamlTab.module.css';

export const YamlTab: Component = () => {
  const [yamlText, setYamlText] = createSignal('');
  const [parseError, setParseError] = createSignal<string | null>(null);
  const [isSaving, setIsSaving] = createSignal(false);

  createEffect(() => {
    const cfg = configStore.config;
    if (cfg) {
      const serialized = YAML.stringify(cfg, { lineWidth: 0 });
      setYamlText(serialized);
      setParseError(null);
    }
  });

  const validateYaml = (text: string) => {
    try {
      YAML.parse(text);
      setParseError(null);
    } catch (e) {
      setParseError(e instanceof Error ? e.message : 'Invalid YAML');
    }
  };

  const handleInput = (e: InputEvent) => {
    const text = (e.currentTarget as HTMLTextAreaElement).value;
    setYamlText(text);
    validateYaml(text);
    configStore.markDirty();
  };

  const handleSave = async () => {
    if (parseError()) return;
    setIsSaving(true);
    try {
      const parsed = YAML.parse(yamlText()) as Record<string, unknown>;
      for (const [key, value] of Object.entries(parsed)) {
        if (key.startsWith('_')) continue;
        await configStore.saveConfig(key, value);
      }
    } finally {
      setIsSaving(false);
    }
  };

  const lineCount = () => {
    const count = yamlText().split('\n').length;
    return Math.max(count, 20);
  };

  const lineNumbers = () => {
    const count = lineCount();
    const lines: string[] = [];
    for (let i = 1; i <= count; i++) {
      lines.push(String(i));
    }
    return lines;
  };

  return (
    <div class={styles.container}>
      <div class={styles.toolbar}>
        <span class={styles.title}>config.yaml</span>
        <div class={styles.actions}>
          <Show when={parseError()}>
            <span class={styles.error}>{parseError()}</span>
          </Show>
          <Show when={!parseError() && configStore.isDirty}>
            <span class={styles.valid}>Valid YAML</span>
          </Show>
          <Button
            size="sm"
            variant="primary"
            disabled={!!parseError() || isSaving()}
            onClick={handleSave}
          >
            {isSaving() ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>
      <div class={styles.editor}>
        <div class={styles.lineNumbers} aria-hidden="true">
          {lineNumbers().map((n) => (
            <div class={styles.lineNum}>{n}</div>
          ))}
        </div>
        <textarea
          class={styles.textarea}
          value={yamlText()}
          rows={lineCount()}
          spellcheck={false}
          onInput={handleInput}
        />
      </div>
    </div>
  );
};
