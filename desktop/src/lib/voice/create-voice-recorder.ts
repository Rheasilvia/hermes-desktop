/**
 * SolidJS voice recorder primitive (dictation mode).
 * Ported from apps/desktop/.../use-voice-recorder.ts.
 */
import { createSignal, onCleanup } from 'solid-js';
import { api } from '@/services/api/router.js';
import { createMicRecorder } from './mic-recorder.js';

export type VoiceStatus = 'idle' | 'recording' | 'transcribing';

export interface VoiceActivityState {
  elapsedSeconds: number;
  level: number;
  status: VoiceStatus;
}

const ERROR_COPY = {
  microphoneAccessDenied: 'Microphone access was denied',
  microphoneConstraintsUnsupported: 'Microphone constraints not supported',
  microphoneInUse: 'Microphone is in use',
  microphonePermissionDenied: 'Microphone permission denied',
  microphoneStartFailed: 'Failed to start microphone',
  microphoneUnsupported: 'Microphone not supported',
  noMicrophone: 'No microphone found',
};

export interface VoiceRecorderOptions {
  maxRecordingSeconds: number | (() => number);
  focusInput: () => void;
  onTranscript: (text: string) => void;
  onError?: (msg: string) => void;
}

export interface VoiceRecorderResult {
  dictate(): void;
  voiceActivityState(): VoiceActivityState;
  voiceStatus(): VoiceStatus;
}

export function createVoiceRecorder(opts: VoiceRecorderOptions): VoiceRecorderResult {
  const recorder = createMicRecorder(ERROR_COPY);
  const [voiceStatus, setVoiceStatus] = createSignal<VoiceStatus>('idle');
  const [elapsedSeconds, setElapsedSeconds] = createSignal(0);

  let startedAt = 0;
  let intervalId: number | null = null;
  let timeoutId: number | null = null;

  const clearTimers = () => {
    if (intervalId != null) { clearInterval(intervalId); intervalId = null; }
    if (timeoutId != null) { clearTimeout(timeoutId); timeoutId = null; }
  };

  onCleanup(() => { clearTimers(); recorder.handle.cancel(); });

  const stop = async () => {
    clearTimers();
    const result = await recorder.handle.stop();
    if (!result) { setVoiceStatus('idle'); return; }
    setVoiceStatus('transcribing');
    try {
      const mimeType = result.audio.type || 'audio/webm';
      const arrayBuffer = await result.audio.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      let binary = '';
      for (const b of bytes) binary += String.fromCharCode(b);
      const base64 = btoa(binary);
      const dataUrl = `data:${mimeType};base64,${base64}`;

      const resp = await api.audio().transcribe(dataUrl, mimeType);
      const transcript = resp.transcript.trim();
      if (!transcript) {
        opts.onError?.('No speech detected. Try recording again.');
      } else {
        opts.onTranscript(transcript);
      }
    } catch (err) {
      opts.onError?.('Transcription failed');
    } finally {
      setVoiceStatus('idle');
      opts.focusInput();
    }
  };

  const start = async () => {
    try {
      await recorder.handle.start({ onError: (e) => opts.onError?.(e.message) });
      startedAt = Date.now();
      setElapsedSeconds(0);
      setVoiceStatus('recording');
      intervalId = setInterval(() => setElapsedSeconds((Date.now() - startedAt) / 1000), 250) as unknown as number;
      const rawMax = typeof opts.maxRecordingSeconds === 'function'
        ? opts.maxRecordingSeconds()
        : opts.maxRecordingSeconds;
      const cap = Math.max(1, Math.min(Math.trunc(rawMax), 600));
      timeoutId = setTimeout(() => void stop(), cap * 1000) as unknown as number;
    } catch (err) {
      setVoiceStatus('idle');
      opts.onError?.(err instanceof Error ? err.message : 'Recording failed');
    }
  };

  const dictate = () => {
    if (recorder.isRecording()) void stop();
    else if (voiceStatus() === 'idle') void start();
  };

  return {
    dictate,
    voiceStatus,
    voiceActivityState: () => ({
      elapsedSeconds: elapsedSeconds(),
      level: recorder.getLevel(),
      status: voiceStatus(),
    }),
  };
}
