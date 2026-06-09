import { fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { describe, expect, test, vi, beforeEach } from 'vitest';
import { VoiceTab } from '../tabs/VoiceTab.js';

const storeState = vi.hoisted(() => ({
  config: {
    tts: {
      provider: 'openai',
      openai: { model: 'gpt-4o-mini-tts', voice: 'alloy' },
      elevenlabs: { voice_id: 'custom-eleven', model_id: 'eleven_multilingual_v2' },
    },
    stt: {
      enabled: true,
      provider: 'openai',
      openai: { model: 'whisper-1' },
      local: { model: 'base', language: '' },
    },
    voice: {
      auto_tts: false,
      record_key: 'ctrl+b',
      max_recording_seconds: 120,
    },
  } as Record<string, unknown> | null,
  schema: {
    fields: {
      'tts.provider': { type: 'select', description: 'Text-to-speech provider', options: ['edge', 'openai', 'elevenlabs'] },
      'stt.enabled': { type: 'boolean', description: 'Speech to text' },
      'stt.provider': { type: 'select', description: 'Speech-to-text provider', options: ['local', 'openai', 'groq'] },
      'voice.auto_tts': { type: 'boolean', description: 'Read responses aloud' },
      'tts.edge.voice': { type: 'string', description: 'Edge voice' },
      'tts.openai.model': { type: 'select', description: 'OpenAI TTS model', options: ['gpt-4o-mini-tts', 'tts-1'] },
      'tts.openai.voice': { type: 'select', description: 'OpenAI voice', options: ['alloy', 'nova'] },
      'tts.elevenlabs.voice_id': { type: 'string', description: 'ElevenLabs voice' },
      'tts.elevenlabs.model_id': { type: 'select', description: 'ElevenLabs TTS model', options: ['eleven_multilingual_v2'] },
      'stt.openai.model': { type: 'select', description: 'OpenAI STT model', options: ['whisper-1', 'gpt-4o-transcribe'] },
      'stt.groq.model': { type: 'string', description: 'Groq STT model' },
      'voice.record_key': { type: 'string', description: 'Voice shortcut' },
      'voice.max_recording_seconds': { type: 'number', description: 'Max recording length' },
    },
    category_order: ['voice', 'tts', 'stt'],
  },
  markDirty: vi.fn(),
  saveConfig: vi.fn(),
}));

vi.mock('@/stores/settings.js', () => ({
  settingsStore: {
    get config() {
      return storeState.config;
    },
    get configSchema() {
      return storeState.schema;
    },
    markDirty: storeState.markDirty,
    saveConfig: storeState.saveConfig,
  },
}));

vi.mock('@/services/api/router.js', () => ({
  api: {
    audio: () => ({
      getElevenLabsVoices: vi.fn().mockResolvedValue({ available: false, voices: [] }),
    }),
  },
}));

describe('VoiceTab', () => {
  beforeEach(() => {
    storeState.markDirty.mockReset();
    storeState.saveConfig.mockReset();
  });

  test('renders Electron-aligned voice fields without legacy flat STT model', () => {
    render(() => <VoiceTab />);

    expect(screen.getAllByText('Speech To Text').length).toBeGreaterThan(0);
    expect(screen.getByText('Read Responses Aloud')).toBeDefined();
    expect(screen.getByText('Edge Voice')).toBeDefined();
    expect(screen.getByText('ElevenLabs Voice')).toBeDefined();
    expect(screen.getByText('OpenAI STT Model')).toBeDefined();
    expect(screen.getByText('Groq STT Model')).toBeDefined();
    expect(screen.getByText('Max Recording Length')).toBeDefined();
    expect(screen.queryByText('STT Model')).toBeNull();
  });

  test('saves nested config dotpaths from schema fields', async () => {
    render(() => <VoiceTab />);

    const maxLength = screen.getByDisplayValue('120');
    fireEvent.change(maxLength, { target: { value: '45' } });

    await waitFor(() => {
      expect(storeState.saveConfig).toHaveBeenCalledWith('voice.max_recording_seconds', 45);
    });
    expect(storeState.markDirty).toHaveBeenCalled();
  });

  test('preserves custom current select value in provider options', () => {
    storeState.config = {
      ...storeState.config,
      tts: {
        provider: 'custom-tts',
        openai: { model: 'gpt-4o-mini-tts', voice: 'alloy' },
      },
    };

    render(() => <VoiceTab />);

    expect(screen.getByText('custom-tts')).toBeDefined();
  });
});
