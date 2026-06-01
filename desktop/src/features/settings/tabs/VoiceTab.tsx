import type { Component } from 'solid-js';
import { settingsStore } from '@/stores/settings.js';
import { ConfigField } from '../ConfigField.js';
import styles from './VoiceTab.module.css';

const TTS_PROVIDER_OPTIONS = [
  { value: 'elevenlabs', label: 'ElevenLabs' },
  { value: 'openai', label: 'OpenAI TTS' },
  { value: 'system', label: 'System Default' },
];

const STT_PROVIDER_OPTIONS = [
  { value: 'openai', label: 'OpenAI Whisper' },
  { value: 'system', label: 'System Default' },
];

export const VoiceTab: Component = () => {
  const config = () => settingsStore.config;
  const tts = () => config()?.tts;
  const stt = () => config()?.stt;

  const handleChange = (key: string, value: unknown) => {
    settingsStore.markDirty();
    settingsStore.saveConfig(key, value);
  };

  return (
    <div class={styles.tab}>
      <section class={styles.section}>
        <h3 class={styles.sectionTitle}>Text-to-Speech</h3>
        <ConfigField
          label="Enable TTS"
          description="Read agent responses aloud"
          type="toggle"
          value={tts()?.enabled ?? false}
          onChange={(v) => handleChange('tts.enabled', v)}
        />
        <ConfigField
          label="TTS Provider"
          description="Speech synthesis provider"
          type="select"
          value={tts()?.provider ?? 'system'}
          options={TTS_PROVIDER_OPTIONS}
          onChange={(v) => handleChange('tts.provider', v)}
        />
        <ConfigField
          label="Voice"
          description="Voice identifier for the selected provider"
          type="text"
          value={tts()?.voice ?? ''}
          placeholder="e.g. alloy, nova, Rachel"
          onChange={(v) => handleChange('tts.voice', v)}
        />
      </section>

      <section class={styles.section}>
        <h3 class={styles.sectionTitle}>Speech-to-Text</h3>
        <ConfigField
          label="Enable STT"
          description="Transcribe voice memos and audio input"
          type="toggle"
          value={stt()?.enabled ?? false}
          onChange={(v) => handleChange('stt.enabled', v)}
        />
        <ConfigField
          label="STT Provider"
          description="Speech recognition provider"
          type="select"
          value={stt()?.provider ?? 'openai'}
          options={STT_PROVIDER_OPTIONS}
          onChange={(v) => handleChange('stt.provider', v)}
        />
        <ConfigField
          label="STT Model"
          description="Model identifier for speech recognition"
          type="text"
          value={stt()?.model ?? ''}
          placeholder="e.g. whisper-1"
          onChange={(v) => handleChange('stt.model', v)}
        />
      </section>
    </div>
  );
};
