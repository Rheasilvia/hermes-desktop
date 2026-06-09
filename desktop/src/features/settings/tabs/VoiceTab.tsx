import type { Component } from 'solid-js';
import { createResource, For, Show } from 'solid-js';
import { settingsStore } from '@/stores/settings.js';
import { api } from '@/services/api/router.js';
import { ConfigField } from '../ConfigField.js';
import type { ConfigFieldProps } from '../ConfigField.js';
import styles from './VoiceTab.module.css';

interface VoiceField {
  path: string;
  label: string;
  description?: string;
}

const CORE_FIELDS: VoiceField[] = [
  { path: 'tts.provider', label: 'Text To Speech Provider', description: 'Speech synthesis provider' },
  { path: 'stt.enabled', label: 'Speech To Text', description: 'Enable dictation and audio transcription' },
  { path: 'stt.provider', label: 'Speech To Text Provider', description: 'Speech recognition provider' },
  { path: 'voice.auto_tts', label: 'Read Responses Aloud', description: 'Automatically read assistant responses when they complete' },
];

const TTS_PROVIDER_FIELDS: Record<string, VoiceField[]> = {
  edge: [{ path: 'tts.edge.voice', label: 'Edge Voice' }],
  openai: [
    { path: 'tts.openai.model', label: 'OpenAI TTS Model' },
    { path: 'tts.openai.voice', label: 'OpenAI Voice' },
  ],
  elevenlabs: [
    { path: 'tts.elevenlabs.voice_id', label: 'ElevenLabs Voice' },
    { path: 'tts.elevenlabs.model_id', label: 'ElevenLabs TTS Model' },
  ],
  xai: [
    { path: 'tts.xai.voice_id', label: 'xAI Voice' },
    { path: 'tts.xai.language', label: 'xAI Language' },
  ],
  minimax: [
    { path: 'tts.minimax.model', label: 'MiniMax TTS Model' },
    { path: 'tts.minimax.voice_id', label: 'MiniMax Voice' },
  ],
  mistral: [
    { path: 'tts.mistral.model', label: 'Mistral TTS Model' },
    { path: 'tts.mistral.voice_id', label: 'Mistral Voice' },
  ],
  gemini: [
    { path: 'tts.gemini.model', label: 'Gemini TTS Model' },
    { path: 'tts.gemini.voice', label: 'Gemini Voice' },
  ],
  neutts: [
    { path: 'tts.neutts.model', label: 'NeuTTS Model' },
    { path: 'tts.neutts.device', label: 'NeuTTS Device' },
  ],
  kittentts: [
    { path: 'tts.kittentts.model', label: 'KittenTTS Model' },
    { path: 'tts.kittentts.voice', label: 'KittenTTS Voice' },
  ],
  piper: [{ path: 'tts.piper.voice', label: 'Piper Voice' }],
};

const STT_PROVIDER_FIELDS: Record<string, VoiceField[]> = {
  local: [
    { path: 'stt.local.model', label: 'Local STT Model' },
    { path: 'stt.local.language', label: 'Local STT Language' },
  ],
  openai: [{ path: 'stt.openai.model', label: 'OpenAI STT Model' }],
  groq: [{ path: 'stt.groq.model', label: 'Groq STT Model' }],
  mistral: [{ path: 'stt.mistral.model', label: 'Mistral STT Model' }],
  elevenlabs: [
    { path: 'stt.elevenlabs.model_id', label: 'ElevenLabs STT Model' },
    { path: 'stt.elevenlabs.language_code', label: 'ElevenLabs Language' },
    { path: 'stt.elevenlabs.tag_audio_events', label: 'Tag Audio Events' },
    { path: 'stt.elevenlabs.diarize', label: 'Diarize Speakers' },
  ],
};

const RECORDING_FIELDS: VoiceField[] = [
  { path: 'voice.record_key', label: 'Voice Shortcut', description: 'Keyboard shortcut used by CLI voice mode' },
  { path: 'voice.max_recording_seconds', label: 'Max Recording Length', description: 'Maximum dictation recording length in seconds' },
];

const OPTION_LABELS: Record<string, string> = {
  edge: 'Edge',
  elevenlabs: 'ElevenLabs',
  openai: 'OpenAI',
  xai: 'xAI',
  minimax: 'MiniMax',
  mistral: 'Mistral',
  gemini: 'Gemini',
  neutts: 'NeuTTS',
  kittentts: 'KittenTTS',
  piper: 'Piper',
  local: 'Local',
  groq: 'Groq',
};

function getPath(root: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((current, part) => {
    if (!current || typeof current !== 'object') return undefined;
    return (current as Record<string, unknown>)[part];
  }, root);
}

function fieldType(schemaType: string | undefined): ConfigFieldProps['type'] {
  if (schemaType === 'boolean') return 'toggle';
  if (schemaType === 'number') return 'number';
  if (schemaType === 'select') return 'select';
  return 'text';
}

function titleFromPath(path: string): string {
  return path
    .split('.')
    .slice(-2)
    .join(' ')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export const VoiceTab: Component = () => {
  const config = () => settingsStore.config;
  const schema = () => settingsStore.configSchema?.fields ?? {};
  const ttsProvider = () => String(getPath(config(), 'tts.provider') ?? 'edge');
  const sttProvider = () => String(getPath(config(), 'stt.provider') ?? 'local');

  const [elevenLabsVoices] = createResource(async () => {
    try {
      return await api.audio().getElevenLabsVoices();
    } catch {
      return { available: false, voices: [] };
    }
  });

  const handleChange = (key: string, value: unknown) => {
    settingsStore.markDirty();
    void settingsStore.saveConfig(key, value);
  };

  const fieldOptions = (path: string, value: unknown) => {
    const options = [...((schema()[path]?.options as string[] | undefined) ?? [])];
    if (path === 'tts.elevenlabs.voice_id' && elevenLabsVoices()?.available) {
      for (const voice of elevenLabsVoices()!.voices) {
        if (!options.includes(voice.voice_id)) options.push(voice.voice_id);
      }
    }
    const current = typeof value === 'string' ? value : '';
    if (current && !options.includes(current)) options.unshift(current);
    return options.map((option) => {
      const voice = path === 'tts.elevenlabs.voice_id'
        ? elevenLabsVoices()?.voices.find((item) => item.voice_id === option)
        : null;
      return {
        value: option,
        label: voice?.label ?? OPTION_LABELS[option] ?? option,
      };
    });
  };

  const renderField = (field: VoiceField) => {
    const meta = () => schema()[field.path];
    const value = () => getPath(config(), field.path);
    return (
      <ConfigField
        label={field.label || titleFromPath(field.path)}
        description={field.description ?? meta()?.description}
        type={fieldType(meta()?.type)}
        value={value()}
        options={fieldOptions(field.path, value())}
        onChange={(next) => handleChange(field.path, next)}
      />
    );
  };

  const providerFields = () => [
    ...(TTS_PROVIDER_FIELDS[ttsProvider()] ?? []),
    ...(STT_PROVIDER_FIELDS[sttProvider()] ?? []),
  ].filter((field) => schema()[field.path] || getPath(config(), field.path) !== undefined);

  return (
    <div class={styles.tab}>
      <section class={styles.section}>
        <h3 class={styles.sectionTitle}>Voice</h3>
        <For each={CORE_FIELDS}>{renderField}</For>
      </section>

      <Show when={providerFields().length > 0}>
        <section class={styles.section}>
          <h3 class={styles.sectionTitle}>Provider Details</h3>
          <For each={providerFields()}>{renderField}</For>
        </section>
      </Show>

      <section class={styles.section}>
        <h3 class={styles.sectionTitle}>Recording</h3>
        <For each={RECORDING_FIELDS}>{renderField}</For>
      </section>
    </div>
  );
};
