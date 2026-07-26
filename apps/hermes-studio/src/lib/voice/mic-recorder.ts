/**
 * Framework-agnostic microphone recorder.
 * Ported from apps/desktop/src/app/chat/composer/hooks/use-mic-recorder.ts.
 * Drops the Electron preload bridge — relies on getUserMedia + macOS entitlement.
 */

type BrowserAudioContext = typeof AudioContext;

export interface MicRecorderOptions {
  onLevel?: (level: number) => void;
  onError?: (error: Error) => void;
  onSilence?: () => void;
  silenceLevel?: number;
  silenceMs?: number;
  idleSilenceMs?: number;
}

export interface MicRecording {
  audio: Blob;
  durationMs: number;
  heardSpeech: boolean;
}

export interface MicRecorderErrorCopy {
  microphoneAccessDenied: string;
  microphoneConstraintsUnsupported: string;
  microphoneInUse: string;
  microphonePermissionDenied: string;
  microphoneStartFailed: string;
  microphoneUnsupported: string;
  noMicrophone: string;
}

export interface MicRecorderHandle {
  start(options?: MicRecorderOptions): Promise<void>;
  stop(): Promise<MicRecording | null>;
  cancel(): void;
}

export interface MicRecorderState {
  handle: MicRecorderHandle;
  getLevel(): number;
  isRecording(): boolean;
}

function micError(error: unknown, copy: MicRecorderErrorCopy): Error {
  const name = error instanceof DOMException ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return new Error(copy.microphonePermissionDenied);
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') return new Error(copy.noMicrophone);
  if (name === 'NotReadableError' || name === 'TrackStartError') return new Error(copy.microphoneInUse);
  if (name === 'OverconstrainedError') return new Error(copy.microphoneConstraintsUnsupported);
  if (error instanceof Error) return error;
  return new Error(copy.microphoneStartFailed);
}

/**
 * Create a mic recorder controller. Not a SolidJS primitive — callers must
 * manage cleanup (call handle.cancel() on unmount / onCleanup).
 */
export function createMicRecorder(copy: MicRecorderErrorCopy): MicRecorderState {
  let _level = 0;
  let _recording = false;
  let _levelListeners: Array<(v: number) => void> = [];
  let _recordingListeners: Array<(v: boolean) => void> = [];

  let recorderRef: MediaRecorder | null = null;
  let streamRef: MediaStream | null = null;
  let chunksRef: Blob[] = [];
  let audioContextRef: AudioContext | null = null;
  let animationRef: number | null = null;
  let startedAtRef = 0;
  let heardSpeechRef = false;
  let silenceTriggeredRef = false;
  let silenceStartedAtRef: number | null = null;
  let stopResolverRef: ((r: MicRecording | null) => void) | null = null;

  const setLevel = (v: number) => {
    _level = v;
    _levelListeners.forEach((fn) => fn(v));
  };

  const setRecording = (v: boolean) => {
    _recording = v;
    _recordingListeners.forEach((fn) => fn(v));
  };

  const cleanup = () => {
    if (animationRef != null) { cancelAnimationFrame(animationRef); animationRef = null; }
    audioContextRef?.close();
    audioContextRef = null;
    streamRef?.getTracks().forEach((t) => t.stop());
    streamRef = null;
    recorderRef = null;
    setLevel(0);
    setRecording(false);
    silenceTriggeredRef = false;
  };

  const startMeter = (stream: MediaStream, options: MicRecorderOptions) => {
    const win = window as Window & { webkitAudioContext?: BrowserAudioContext };
    const Ctor = window.AudioContext || win.webkitAudioContext;
    if (!Ctor) return;
    try {
      const ctx = new Ctor();
      const analyser = ctx.createAnalyser();
      const source = ctx.createMediaStreamSource(stream);
      analyser.fftSize = 256;
      const data = new Uint8Array(analyser.fftSize);
      source.connect(analyser);
      audioContextRef = ctx;

      const tick = () => {
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (const v of data) { const c = v - 128; sum += c * c; }
        const rms = Math.sqrt(sum / data.length);
        const normalized = Math.min(1, rms / 42);
        const now = Date.now();
        setLevel(normalized);
        options.onLevel?.(normalized);

        const speechThreshold = options.silenceLevel ?? 0;
        const silenceMs = options.silenceMs ?? 0;
        const idleSilenceMs = options.idleSilenceMs ?? 0;

        if (speechThreshold > 0 && options.onSilence && !silenceTriggeredRef) {
          if (normalized >= speechThreshold) {
            heardSpeechRef = true;
            silenceStartedAtRef = null;
          } else if (heardSpeechRef && silenceMs > 0) {
            silenceStartedAtRef ??= now;
            if (now - silenceStartedAtRef >= silenceMs) { silenceTriggeredRef = true; options.onSilence(); return; }
          } else if (!heardSpeechRef && idleSilenceMs > 0 && now - startedAtRef >= idleSilenceMs) {
            silenceTriggeredRef = true; options.onSilence(); return;
          }
        }

        animationRef = requestAnimationFrame(tick);
      };
      tick();
    } catch { setLevel(0); }
  };

  const start: MicRecorderHandle['start'] = async (options = {}) => {
    if (recorderRef) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      throw new Error(copy.microphoneUnsupported);
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch (err) { throw micError(err, copy); }

    const mimeType = (
      ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/ogg', 'audio/wav']
        .find((t) => MediaRecorder.isTypeSupported(t))
    ) ?? '';

    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    } catch (err) { stream.getTracks().forEach((t) => t.stop()); throw micError(err, copy); }

    chunksRef = [];
    streamRef = stream;
    recorderRef = recorder;
    heardSpeechRef = false;
    silenceTriggeredRef = false;
    silenceStartedAtRef = null;
    startedAtRef = Date.now();

    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.push(e.data); };
    recorder.onstop = () => {
      const chunks = chunksRef;
      const recordingType = recorder.mimeType || mimeType || 'audio/webm';
      const durationMs = Date.now() - startedAtRef;
      const heardSpeech = heardSpeechRef;
      chunksRef = [];
      cleanup();
      const resolver = stopResolverRef; stopResolverRef = null;
      if (!chunks.length) { resolver?.(null); return; }
      resolver?.({ audio: new Blob(chunks, { type: recordingType }), durationMs, heardSpeech });
    };
    recorder.onerror = (e) => {
      const err = micError((e as Event & { error?: unknown }).error, copy);
      const resolver = stopResolverRef; stopResolverRef = null;
      cleanup();
      options.onError?.(err);
      resolver?.(null);
    };

    recorder.start();
    setRecording(true);
    startMeter(stream, options);
  };

  const stop: MicRecorderHandle['stop'] = () =>
    new Promise<MicRecording | null>((resolve) => {
      const recorder = recorderRef;
      if (!recorder || recorder.state === 'inactive') { cleanup(); resolve(null); return; }
      stopResolverRef = resolve;
      recorder.stop();
    });

  const cancel: MicRecorderHandle['cancel'] = () => {
    const recorder = recorderRef;
    const resolver = stopResolverRef; stopResolverRef = null;
    if (recorder && recorder.state !== 'inactive') {
      recorder.ondataavailable = null; recorder.onerror = null; recorder.onstop = null; recorder.stop();
    }
    cleanup(); resolver?.(null);
  };

  return {
    handle: { start, stop, cancel },
    getLevel: () => _level,
    isRecording: () => _recording,
  };
}
