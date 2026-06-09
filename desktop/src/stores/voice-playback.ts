import { createSignal } from 'solid-js';

export type VoicePlaybackSource = 'read-aloud' | 'voice-conversation';
export type VoicePlaybackStatus = 'idle' | 'preparing' | 'speaking';

export interface VoicePlaybackState {
  audioElement: HTMLAudioElement | null;
  messageId: string | null;
  sequence: number;
  source: VoicePlaybackSource | null;
  status: VoicePlaybackStatus;
}

const [voicePlayback, setVoicePlayback] = createSignal<VoicePlaybackState>({
  audioElement: null,
  messageId: null,
  sequence: 0,
  source: null,
  status: 'idle',
});

export { voicePlayback };
export { setVoicePlayback as setVoicePlaybackState };
