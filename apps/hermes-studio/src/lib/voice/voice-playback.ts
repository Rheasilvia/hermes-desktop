import { api } from '@/services/api/router.js';
import { setVoicePlaybackState, voicePlayback, type VoicePlaybackSource } from '@/stores/voice-playback.js';
import { sanitizeTextForSpeech } from './speech-text.js';

let currentAudio: HTMLAudioElement | null = null;
let currentStop: (() => void) | null = null;
let sequence = 0;

export interface VoicePlaybackOptions {
  messageId?: string | null;
  source: VoicePlaybackSource;
}

export function stopVoicePlayback(): void {
  sequence += 1;
  currentStop?.();
  currentStop = null;
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.src = '';
    currentAudio.load();
    currentAudio = null;
  }
  setVoicePlaybackState({
    audioElement: null,
    messageId: null,
    sequence,
    source: null,
    status: 'idle',
  });
}

export async function playSpeechText(text: string, options: VoicePlaybackOptions): Promise<boolean> {
  stopVoicePlayback();
  const speakableText = sanitizeTextForSpeech(text);
  if (!speakableText) return false;

  const ownSequence = sequence;
  const isCurrent = () => ownSequence === sequence;

  setVoicePlaybackState({ audioElement: null, messageId: options.messageId ?? null, sequence, source: options.source, status: 'preparing' });

  try {
    const response = await api.audio().speak(speakableText);
    if (!isCurrent()) return false;

    const audio = new Audio(response.data_url);
    currentAudio = audio;
    setVoicePlaybackState({ audioElement: audio, messageId: options.messageId ?? null, sequence, source: options.source, status: 'speaking' });

    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        audio.removeEventListener('ended', onEnded);
        audio.removeEventListener('error', onError);
        currentStop = null;
      };
      const onEnded = () => { cleanup(); resolve(); };
      const onError = () => { cleanup(); reject(new Error('Playback failed')); };
      currentStop = () => { cleanup(); resolve(); };
      audio.addEventListener('ended', onEnded, { once: true });
      audio.addEventListener('error', onError, { once: true });
      audio.play().catch(reject);
    });

    if (!isCurrent()) return false;
    currentAudio = null;
    setVoicePlaybackState({ audioElement: null, messageId: null, sequence, source: null, status: 'idle' });
    return true;
  } catch (error) {
    if (isCurrent()) {
      currentStop = null;
      currentAudio = null;
      setVoicePlaybackState({ audioElement: null, messageId: null, sequence, source: null, status: 'idle' });
    }
    throw error;
  }
}

export function isVoicePlaybackActive(): boolean {
  return voicePlayback().status !== 'idle';
}
