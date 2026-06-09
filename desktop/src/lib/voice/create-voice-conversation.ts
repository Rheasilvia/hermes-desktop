/**
 * SolidJS voice conversation primitive (hands-free loop).
 * Ported from apps/desktop/.../use-voice-conversation.ts.
 * React refs → module-level refs; React effects → SolidJS createEffect + onCleanup.
 */
import { createEffect, createSignal, onCleanup } from 'solid-js';
import { api } from '@/services/api/router.js';
import { playSpeechText, stopVoicePlayback } from './voice-playback.js';
import { createMicRecorder } from './mic-recorder.js';

export type ConversationStatus = 'idle' | 'listening' | 'transcribing' | 'thinking' | 'speaking';

export interface PendingVoiceResponse {
  id: string;
  pending: boolean;
  text: string;
}

export interface VoiceConversationOptions {
  busy: () => boolean;
  enabled: () => boolean;
  onFatalError?: () => void;
  onSubmit: (text: string) => Promise<void> | void;
  pendingResponse: () => PendingVoiceResponse | null;
  consumePendingResponse: () => void;
  onError?: (msg: string) => void;
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

export interface VoiceConversationResult {
  status: () => ConversationStatus;
  muted: () => boolean;
  level: () => number;
  start: () => Promise<void>;
  end: () => Promise<void>;
  stopTurn: () => void;
  toggleMute: () => void;
}

export function createVoiceConversation(opts: VoiceConversationOptions): VoiceConversationResult {
  const recorder = createMicRecorder(ERROR_COPY);
  const [status, setStatus] = createSignal<ConversationStatus>('idle');
  const [muted, setMuted] = createSignal(false);

  // Mutable refs (no reactive tracking needed)
  let turnTimeoutId: number | null = null;
  let pendingStartRef = false;
  let turnClosingRef = false;
  let awaitingSpokenResponseRef = false;
  let responseIdRef: string | null = null;
  let spokenSourceLengthRef = 0;
  let speechBufferRef = '';

  onCleanup(() => {
    clearTurnTimeout();
    stopVoicePlayback();
    recorder.handle.cancel();
  });

  const clearTurnTimeout = () => {
    if (turnTimeoutId != null) { clearTimeout(turnTimeoutId); turnTimeoutId = null; }
  };

  const resetSpeechBuffer = () => {
    responseIdRef = null;
    spokenSourceLengthRef = 0;
    speechBufferRef = '';
  };

  const appendSpeechText = (text: string) => {
    if (!text) return;
    speechBufferRef = `${speechBufferRef}${text}`;
  };

  const takeSpeechChunk = (force = false): string | null => {
    const buffer = speechBufferRef.replace(/\s+/g, ' ').trim();
    if (!buffer) { speechBufferRef = ''; return null; }

    const sentence = buffer.match(/^(.+?[.!?。！？])(?:\s+|$)/);
    if (sentence?.[1] && (sentence[1].length >= 8 || force)) {
      const chunk = sentence[1].trim();
      speechBufferRef = buffer.slice(sentence[1].length).trim();
      return chunk;
    }

    if (!force && buffer.length > 220) {
      const softBoundary = Math.max(
        buffer.lastIndexOf(', ', 180),
        buffer.lastIndexOf('; ', 180),
        buffer.lastIndexOf(': ', 180),
      );
      if (softBoundary > 80) {
        const chunk = buffer.slice(0, softBoundary + 1).trim();
        speechBufferRef = buffer.slice(softBoundary + 1).trim();
        return chunk;
      }
    }

    if (!force) return null;
    speechBufferRef = '';
    return buffer;
  };

  const handleTurn = async (forceTranscribe = false) => {
    if (turnClosingRef) return;
    turnClosingRef = true;
    clearTurnTimeout();
    setStatus('transcribing');
    try {
      const result = await recorder.handle.stop();
      if (!result || (!result.heardSpeech && !forceTranscribe)) {
        if (opts.enabled() && !muted() && !opts.busy() && status() !== 'speaking') pendingStartRef = true;
        setStatus('idle');
        return;
      }
      try {
        // Blobify + base64-encode + call transcription API
        const mimeType = result.audio.type || 'audio/webm';
        const ab = await result.audio.arrayBuffer();
        const bytes = new Uint8Array(ab);
        let binary = '';
        for (const b of bytes) binary += String.fromCharCode(b);
        const base64 = btoa(binary);
        const dataUrl = `data:${mimeType};base64,${base64}`;
        const resp = await api.audio().transcribe(dataUrl, mimeType);
        const transcript = resp.transcript.trim();
        if (!transcript) {
          if (opts.enabled()) pendingStartRef = true;
          setStatus('idle');
          return;
        }
        awaitingSpokenResponseRef = true;
        resetSpeechBuffer();
        await opts.onSubmit(transcript);
        setStatus('thinking');
      } catch {
        opts.onError?.('Transcription failed');
        if (opts.enabled() && !muted() && !opts.busy()) pendingStartRef = true;
        setStatus('idle');
      }
    } finally {
      turnClosingRef = false;
    }
  };

  const startListening = async () => {
    pendingStartRef = false;
    if (!opts.enabled() || muted() || opts.busy()) return;
    if (status() !== 'idle') return;
    try {
      // VAD tuning mirrors tools.voice_mode defaults
      await recorder.handle.start({
        silenceLevel: 0.075,
        silenceMs: 1_250,
        idleSilenceMs: 12_000,
        onError: (err) => {
          opts.onError?.(err.message);
          pendingStartRef = false;
          opts.onFatalError?.();
        },
        onSilence: () => void handleTurn(),
      });
      setStatus('listening');
      turnTimeoutId = setTimeout(() => void handleTurn(), 60_000) as unknown as number;
    } catch (err) {
      opts.onError?.(err instanceof Error ? err.message : 'Could not start session');
      pendingStartRef = false;
      setStatus('idle');
      opts.onFatalError?.();
    }
  };

  const speak = async (text: string) => {
    setStatus('speaking');
    try {
      await playSpeechText(text, { source: 'voice-conversation' });
    } catch {
      opts.onError?.('Playback failed');
    } finally {
      if (opts.enabled()) { pendingStartRef = true; setStatus('idle'); }
      else setStatus('idle');
    }
  };

  const start = async () => {
    setMuted(false);
    awaitingSpokenResponseRef = false;
    resetSpeechBuffer();
    opts.consumePendingResponse();
    pendingStartRef = true;
    await startListening();
  };

  const end = async () => {
    pendingStartRef = false;
    clearTurnTimeout();
    stopVoicePlayback();
    recorder.handle.cancel();
    turnClosingRef = false;
    awaitingSpokenResponseRef = false;
    resetSpeechBuffer();
    opts.consumePendingResponse();
    setMuted(false);
    setStatus('idle');
  };

  const stopTurn = () => {
    if (status() === 'listening') void handleTurn(true);
  };

  const toggleMute = () => {
    setMuted((v) => {
      const next = !v;
      if (next) { clearTurnTimeout(); recorder.handle.cancel(); setStatus('idle'); }
      else if (opts.enabled() && !opts.busy() && status() === 'idle') pendingStartRef = true;
      return next;
    });
  };

  // Spacebar shortcut: force-end listening turn
  createEffect(() => {
    if (!opts.enabled()) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      if (status() !== 'listening') return;
      e.preventDefault();
      stopTurn();
    };
    window.addEventListener('keydown', onKeyDown, { capture: true });
    onCleanup(() => window.removeEventListener('keydown', onKeyDown, { capture: true }));
  });

  // Drive the conversation loop: speak stable chunks, start listening when idle
  createEffect(() => {
    const _enabled = opts.enabled();
    const _muted = muted();
    const _busy = opts.busy();
    const _status = status();
    const _pendingResponse = opts.pendingResponse();

    if (!_enabled || _muted) return;

    if (awaitingSpokenResponseRef && _status !== 'speaking') {
      if (_pendingResponse) {
        if (_pendingResponse.id !== responseIdRef) { resetSpeechBuffer(); responseIdRef = _pendingResponse.id; }
        if (_pendingResponse.text.length > spokenSourceLengthRef) {
          appendSpeechText(_pendingResponse.text.slice(spokenSourceLengthRef));
          spokenSourceLengthRef = _pendingResponse.text.length;
        }
        const chunk = takeSpeechChunk(!_pendingResponse.pending && !_busy);
        if (chunk) { void speak(chunk); return; }
        if (!_pendingResponse.pending && !_busy) {
          awaitingSpokenResponseRef = false;
          opts.consumePendingResponse();
          resetSpeechBuffer();
          pendingStartRef = true;
          setStatus('idle');
          return;
        }
      }
      if (!_busy && _status === 'thinking') {
        awaitingSpokenResponseRef = false;
        resetSpeechBuffer();
        pendingStartRef = true;
        setStatus('idle');
        return;
      }
    }

    if (_busy || _status !== 'idle') return;
    if (pendingStartRef) void startListening();
  });

  // enabled toggled on/off
  let prevEnabled = opts.enabled();
  createEffect(() => {
    const next = opts.enabled();
    if (next && !prevEnabled) void start();
    if (!next && prevEnabled) void end();
    prevEnabled = next;
  });

  return {
    status,
    muted,
    level: () => recorder.getLevel(),
    start,
    end,
    stopTurn,
    toggleMute,
  };
}
