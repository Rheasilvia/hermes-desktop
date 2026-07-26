import type { HermesConfig } from '@/types/index.js';

const DEFAULT_MAX_RECORDING_SECONDS = 120;
const MAX_RECORDING_SECONDS = 600;

export function isSttEnabled(config: HermesConfig | null | undefined): boolean {
  return config?.stt?.enabled !== false;
}

export function getVoiceRecordingLimit(config: HermesConfig | null | undefined): number {
  const raw = config?.voice?.max_recording_seconds;
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) {
    return DEFAULT_MAX_RECORDING_SECONDS;
  }
  return Math.max(1, Math.min(Math.trunc(raw), MAX_RECORDING_SECONDS));
}

export function isTtsAvailable(config: HermesConfig | null | undefined): boolean {
  return typeof config?.tts?.provider === 'string' && config.tts.provider.trim().length > 0;
}

export function isAutoTtsEnabled(config: HermesConfig | null | undefined): boolean {
  return config?.voice?.auto_tts === true;
}
