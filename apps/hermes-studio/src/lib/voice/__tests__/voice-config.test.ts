import { describe, expect, test } from 'vitest';
import {
  getVoiceRecordingLimit,
  isAutoTtsEnabled,
  isSttEnabled,
  isTtsAvailable,
} from '../voice-config.js';

describe('voice config selectors', () => {
  test('defaults STT on and clamps recording limit like Electron desktop', () => {
    expect(isSttEnabled(null)).toBe(true);
    expect(getVoiceRecordingLimit(null)).toBe(120);
    expect(getVoiceRecordingLimit({ voice: { max_recording_seconds: 0 } })).toBe(120);
    expect(getVoiceRecordingLimit({ voice: { max_recording_seconds: 999 } })).toBe(600);
    expect(getVoiceRecordingLimit({ voice: { max_recording_seconds: 30 } })).toBe(30);
  });

  test('treats configured TTS provider as available without legacy tts.enabled', () => {
    expect(isTtsAvailable({ tts: { provider: 'edge' } })).toBe(true);
    expect(isTtsAvailable({ tts: { provider: '' } })).toBe(false);
    expect(isTtsAvailable({ tts: { enabled: false, provider: 'edge' } })).toBe(true);
  });

  test('reads auto TTS only from voice.auto_tts', () => {
    expect(isAutoTtsEnabled({ voice: { auto_tts: true } })).toBe(true);
    expect(isAutoTtsEnabled({ tts: { enabled: true } })).toBe(false);
  });
});
