import type { HttpClient } from '../../http-client';

export interface ElevenLabsVoice {
  voice_id: string;
  name: string;
  label: string;
}

export interface TranscribeResponse {
  ok: boolean;
  transcript: string;
  provider?: string | null;
}

export interface SpeakResponse {
  ok: boolean;
  data_url: string;
  mime_type: string;
  provider?: string | null;
}

export interface ElevenLabsVoicesResponse {
  available: boolean;
  voices: ElevenLabsVoice[];
}

export interface AudioTransport {
  transcribe(dataUrl: string, mimeType?: string): Promise<TranscribeResponse>;
  speak(text: string): Promise<SpeakResponse>;
  getElevenLabsVoices(): Promise<ElevenLabsVoicesResponse>;
}

export function makeAudioTransport(client: HttpClient): AudioTransport {
  return {
    transcribe: (dataUrl, mimeType) =>
      client.post<TranscribeResponse>('/desktop/api/audio/transcribe', {
        data_url: dataUrl,
        ...(mimeType ? { mime_type: mimeType } : {}),
      }),

    speak: (text) =>
      client.post<SpeakResponse>('/desktop/api/audio/speak', { text }),

    getElevenLabsVoices: () =>
      client.get<ElevenLabsVoicesResponse>('/desktop/api/audio/elevenlabs/voices'),
  };
}
